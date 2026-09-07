// StandUp — main process: tray, windows, notifications, idle detection, 1s tick loop.
//
// NOTE ON LANGUAGE: comments are English, but user-facing strings stay Vietnamese —
// tray menu labels, notification texts, and everything written to standup.log, which
// users are asked to read and paste into bug reports. See CONTRIBUTING.md.
const {
  app, BrowserWindow, Tray, Menu, Notification,
  powerMonitor, ipcMain, nativeImage, screen, shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, execFile } = require('node:child_process');
const { Engine, DEFAULT_SETTINGS, clampSettings } = require('./engine');
const {
  parseSettingsJson, mainWindowHeight, clampWindowY, reminderXY, formatLogLine, shouldRotateLog,
  notificationsAllowedFromState,
} = require('./main-utils');

const AUMID = 'vn.standup.app';

let engine;
let tray = null;
let mainWin = null;
let reminderWin = null;
let onboardWin = null;
let overlayWin = null;

// When Windows starts the app at login, do not throw a window at the user.
const startHidden = process.argv.includes('--hidden');

// ---- Settings (JSON inside the userData folder) ----

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const parsed = parseSettingsJson(fs.readFileSync(settingsFile(), 'utf8'));
    if (parsed) return clampSettings(parsed);
  } catch { /* no file yet — first run */ }
  // A broken file lands here too: running with defaults beats not running.
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  try {
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Write to a temp file and rename: a rename within the same directory is
    // atomic, so a crash or power loss mid-write never leaves truncated JSON.
    // Writing in place means one truncated file makes loadSettings quietly fall
    // back to defaults — every setting lost and the user pushed through
    // onboarding all over again.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Không lưu được cài đặt:', err);
    logEvent('error', `Không lưu được cài đặt: ${err.message}`);
  }
}

// An app living in the tray is very hard to observe when something goes wrong. Set
// the environment variable STANDUP_DEBUG=<file path> to write a DETAILED trace (one
// line per tick: phase, idle, threshold) without opening DevTools. For deep
// debugging only.
function debugLog(line) {
  if (!process.env.STANDUP_DEBUG) return;
  try {
    fs.appendFileSync(process.env.STANDUP_DEBUG, `${new Date().toISOString()}\t${line}\n`);
  } catch { /* a broken log must never kill the app */ }
}

// ---- Event log (ALWAYS ON) ----
// Unlike debugLog, this one always writes, but ONLY noteworthy events (startup,
// phase changes, user actions, settings changes, errors, sleep/wake, exit) into
// userData/standup.log, so there is something to inspect when a user reports a
// problem. Three rules that keep it dependable: (1) write synchronously so no event
// is lost in a crash; (2) rotate so it can never fill the disk; (3) wrap in
// try/catch so a logging failure cannot kill the app.
const LOG_MAX_BYTES = 1_000_000; // ~1 MB, then roll over to standup.log.1 (~2 MB total)

function logFile() {
  return path.join(app.getPath('userData'), 'standup.log');
}

function logEvent(level, message) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (shouldRotateLog(fs.statSync(file).size, LOG_MAX_BYTES)) {
        // On Windows, rename cannot overwrite an existing file → drop the old .1 first.
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
    } catch { /* no file yet — first write, nothing to rotate */ }
    fs.appendFileSync(file, `${formatLogLine(new Date(), level, message)}\n`);
  } catch { /* a broken log must NEVER kill the app */ }
}

// ---- Capture unexpected failures into the log ----
// The log above only records ORDERLY events. But what you need most when an app
// "just breaks" are the unexpected falls: an uncaught error in the main process, a
// dropped promise, or a dead renderer (which is where the sound and the window
// drawing live) — uncaught, they vanish without a trace. The DELIBERATE choice here
// is to log and then try to keep the app alive: this is a background tray app, and
// carrying on reminding beats shutting itself down over a passing error. The
// trade-off: registering uncaughtException silences Electron's default error dialog
// — but a "JavaScript error" box popping up mid-screen is worse for a background
// app; we trade it for one line in standup.log.
function installCrashLogging() {
  process.on('uncaughtException', (err, origin) => {
    logEvent('error', `Lỗi không bắt (${origin}): ${err && err.stack ? err.stack : err}`);
  });
  process.on('unhandledRejection', (reason) => {
    logEvent('error', `Promise bị bỏ rơi: ${reason && reason.stack ? reason.stack : reason}`);
  });
  // One handler at app level catches the renderer of EVERY window. A dead main-window
  // renderer means no sound and no reminder popup — exactly the "notifications
  // disappeared" class of bug.
  app.on('render-process-gone', (_ev, contents, details) => {
    const which = mainWin && contents === mainWin.webContents ? 'cửa sổ chính'
      : reminderWin && contents === reminderWin.webContents ? 'cửa sổ nhắc'
      : onboardWin && contents === onboardWin.webContents ? 'onboarding'
      : overlayWin && contents === overlayWin.webContents ? 'màn nghỉ'
      : 'renderer';
    logEvent('error', `Renderer chết — ${which}: lý do=${details.reason}, mã thoát=${details.exitCode}`);
  });
  // A dead child process (GPU, utility…) is usually harmless, but a dead GPU can
  // cost us picture or sound, so record it for cross-checking when something breaks.
  app.on('child-process-gone', (_ev, details) => {
    const name = details.name ? ` ${details.name}` : '';
    logEvent('error', `Tiến trình con chết — ${details.type}${name}: lý do=${details.reason}, mã thoát=${details.exitCode}`);
  });
}

// Register the AUMID through the registry so toast banners appear reliably. The
// Start Menu shortcut (the classic mechanism the installer creates) is not
// dependable enough: on a real machine we reproduced toasts that only reached the
// Action Center and never raised a banner until this key existed. Written on every
// startup — the operation is idempotent, and HKCU needs no admin rights. The
// uninstaller removes this key (build/installer.nsh).
function registerAumid() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;
  try {
    // REG_EXPAND_SZ, not REG_SZ — some Windows builds only read DisplayName for the
    // banner when it has this type.
    execFileSync('reg', ['add', key, '/v', 'DisplayName', '/t', 'REG_EXPAND_SZ', '/d', 'StandUp', '/f'], { windowsHide: true });
    // IconUri must point at an IMAGE FILE. This used to point at the .exe — the
    // Windows shell cannot extract an icon from that, and it could not read
    // assets/icon.png either because that lives inside app.asar. electron-builder
    // now copies icon.png straight into resources/ (see extraResources in
    // package.json).
    const iconPath = path.join(process.resourcesPath, 'icon.png');
    if (fs.existsSync(iconPath)) {
      execFileSync('reg', ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f'], { windowsHide: true });
    } else {
      // No IconUri at all beats leaving a broken value behind from an older build:
      // Windows falls back to the default icon instead of chasing a dead path.
      try {
        execFileSync('reg', ['delete', key, '/v', 'IconUri', '/f'], { windowsHide: true });
      } catch { /* the value never existed — fine */ }
    }
  } catch (err) {
    console.error('Không đăng ký được AUMID cho toast:', err);
    logEvent('error', `Không đăng ký được AUMID: ${err.message}`);
  }
}

// Has the user pressed the gear to expand the settings panel? The renderer decides
// (it owns the button) and reports back here so the window can resize — see fitMain().
let settingsOpen = false;

// ---- Start with Windows ----

// Only write the startup entry when the app is PACKAGED. A dev build would point at
// electron.exe inside node_modules — deleting node_modules would leave a dead
// startup entry in the registry.
function applyAutoStart(enabled) {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (err) {
    console.error('Không đặt được khởi động cùng Windows:', err);
    logEvent('error', `Không đặt được autostart: ${err.message}`);
  }
}

// ---- Windows ----

// The main window resizes along one axis: settings closed (status + buttons only) or
// open (the gear expands the panel). Both heights were measured for real with
// DevTools (the Windows window frame takes 39px). Cut to fit the content exactly:
// too much leaves empty space, too little hides buttons and adds a scrollbar.
const HEIGHTS = {
  compact: 384, // closed — 331px of content, just the status, 2 buttons and the gear
  full: 864,    // settings open — measured 824px of content + 39px frame = 863
};

function createWindows() {
  mainWin = new BrowserWindow({
    width: 420,
    height: HEIGHTS.compact, // opens compact; expanding the settings grows it
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    show: false, // only show once the content is ready — avoids a white flash
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // This window plays the alert sound even while hidden in the tray → no throttling.
      backgroundThrottling: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  // Forward renderer logs into the diagnostic log — this window is usually hidden,
  // so there is no way to open DevTools and look at errors.
  mainWin.webContents.on('console-message', (...args) => {
    const d = args[0];
    debugLog(`renderer: ${d && typeof d === 'object' && d.message ? d.message : args[2]}`);
  });
  mainWin.once('ready-to-show', () => {
    // On first run onboarding comes first; on autostart we stay quiet in the tray.
    if (!startHidden && engine.settings.onboarded) mainWin.show();
  });
  // Closing the window = collapse to the tray, the app keeps running.
  mainWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  reminderWin = new BrowserWindow({
    width: 380,
    height: 250,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#12141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  reminderWin.loadFile(path.join(__dirname, '..', 'src', 'reminder.html'));
  reminderWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      reminderWin.hide();
    }
  });

  // The break overlay. Built up front (hidden) rather than created on each break:
  // creating a window costs hundreds of milliseconds and flashes a white frame,
  // which is glaring when it covers the entire screen.
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    // Do not use setFullScreen: on Windows it runs a desktop-switch animation that
    // is slow and janky. Setting bounds to the display ourselves is faster and simpler.
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    // Semi-transparent background so the work behind stays visible (the real colour
    // lives in the CSS).
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWin.loadFile(path.join(__dirname, '..', 'src', 'overlay.html'));
  overlayWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      overlayWin.hide();
    }
  });
}

function fitMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  // Measure against the display that currently holds the window, not the primary
  // one: multi-monitor setups very often include one noticeably shorter screen.
  const wa = screen.getDisplayMatching(mainWin.getBounds()).workArea;
  const want = mainWindowHeight(settingsOpen, wa.height, HEIGHTS);
  const b = mainWin.getBounds();
  // Change the POSITION too, not just the height: the window grows downward, so a
  // window sitting mid-screen would push its bottom off the display when the
  // settings expand, swallowing the Save button.
  const y = clampWindowY(b.y, want, wa);
  if (b.height === want && b.y === y) return;
  // On Windows, setSize/setBounds is ignored for a resizable:false window → unlock briefly.
  mainWin.setResizable(true);
  mainWin.setBounds({ x: b.x, y, width: b.width, height: want });
  mainWin.setResizable(false);
}

// An effect from the engine (or a click on a toast) can arrive exactly while the app
// is quitting, once the reminder window has been destroyed — touching it then kills
// the main process. Every operation on the reminder window must go through the two
// functions below.
function reminderAlive() {
  return reminderWin && !reminderWin.isDestroyed();
}

function showReminder() {
  if (!reminderAlive()) return;
  // Pop up on the display holding the mouse cursor — i.e. the screen the user is
  // working on. Using the primary display would put the reminder somewhere the user
  // is not even looking on a multi-monitor setup, which is as good as not reminding.
  // workArea already excludes the taskbar; corner vs centre is the user's choice.
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { x, y } = reminderXY(engine.settings.reminderPosition, wa, reminderWin.getBounds());
  reminderWin.setPosition(x, y);
  // showInactive: show the window but do NOT steal focus — never interrupt typing.
  // However showInactive only puts the window back at its OLD rank within the
  // always-on-top group, so it can still end up beneath another always-on-top window
  // (measured: rank 1, below the taskbar). moveTop() lifts it to the top of the
  // group while still not stealing focus.
  reminderWin.showInactive();
  reminderWin.moveTop();
}

function overlayAlive() {
  return overlayWin && !overlayWin.isDestroyed();
}

function showOverlay() {
  if (!overlayAlive()) return;
  // Cover the whole display the user is working on (chosen by cursor, like the
  // reminder window). Use bounds, not workArea: leaving the taskbar visible makes
  // the overlay look like just a very large window, and the user clicks straight
  // past it into another app — defeating the point.
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  overlayWin.setBounds({ x: d.x, y: d.y, width: d.width, height: d.height });
  // Unlike the reminder window (showInactive, to avoid stealing focus mid-typing),
  // the overlay MUST take focus: the user just pressed "Break now" themselves, and
  // the Esc key only works while the window is focused.
  overlayWin.show();
  overlayWin.focus();
  overlayWin.moveTop();
}

function hideOverlay() {
  if (overlayAlive() && overlayWin.isVisible()) overlayWin.hide();
}

// First run: a single screen, pick the interval and go.
function createOnboarding() {
  onboardWin = new BrowserWindow({
    width: 460,
    height: 710,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  onboardWin.loadFile(path.join(__dirname, '..', 'src', 'onboarding.html'));
  onboardWin.once('ready-to-show', () => onboardWin.show());
  onboardWin.on('closed', () => { onboardWin = null; });
}

function showMain() {
  // Before onboarding is done, always send the user back to that screen first.
  if (onboardWin && !onboardWin.isDestroyed()) {
    onboardWin.show();
    onboardWin.focus();
    return;
  }
  if (!mainWin) return;
  mainWin.show();
  mainWin.focus();
}

// ---- Tray ----

// Draw the tray icon dynamically: minutes remaining (or a status symbol) on a
// coloured background. A 3×5 pixel font, doubled, inside a 16×16 frame — legible
// enough in the notification area.
const GLYPHS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '###', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  '!': ['#', '#', '#', '.', '#'],
  '-': ['...', '...', '###', '...', '...'],
  P: ['#.#', '#.#', '#.#', '#.#', '#.#'], // the pause symbol ‖
};
const GREEN = [16, 163, 127];
const AMBER = [240, 180, 41];
const GRAY = [107, 114, 128];

function trayIcon(text, [r, g, b]) {
  const S = 16;
  const SCALE = 2;
  const buf = Buffer.alloc(S * S * 4); // BGRA
  const put = (x, y, [pr, pg, pb]) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = pb; buf[i + 1] = pg; buf[i + 2] = pr; buf[i + 3] = 255;
  };
  // Background: a square with 2px chamfered corners, easier on the eye.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (Math.min(x, S - 1 - x) + Math.min(y, S - 1 - y) >= 2) put(x, y, [r, g, b]);
    }
  }
  // White text, centred.
  const glyphs = [...String(text)].map((ch) => GLYPHS[ch]).filter(Boolean);
  const wTotal = glyphs.reduce((w, gl) => w + gl[0].length * SCALE, 0) + (glyphs.length - 1) * SCALE;
  let x0 = Math.round((S - wTotal) / 2);
  const y0 = Math.round((S - 5 * SCALE) / 2);
  for (const gl of glyphs) {
    gl.forEach((row, gy) => {
      [...row].forEach((c, gx) => {
        if (c !== '#') return;
        for (let dy = 0; dy < SCALE; dy++) {
          for (let dx = 0; dx < SCALE; dx++) {
            put(x0 + gx * SCALE + dx, y0 + gy * SCALE + dy, [255, 255, 255]);
          }
        }
      });
    });
    x0 += gl[0].length * SCALE + SCALE;
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
}

let lastTrayKey = null;

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('StandUp');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở StandUp', click: showMain },
    { type: 'separator' },
    { label: 'Nghỉ ngay', click: () => userAction('Nghỉ ngay (menu)', () => engine.breakNow(Date.now())) },
    { label: 'Thử nhắc nhở', click: () => userAction('Thử nhắc (menu)', () => engine.triggerReminder(Date.now())) },
    { type: 'separator' },
    { label: 'Tạm dừng 1 giờ', click: () => userAction('Tạm dừng 1 giờ', () => engine.pause(Date.now(), 60)) },
    { label: 'Tạm dừng (đến khi bật lại)', click: () => userAction('Tạm dừng đến khi bật lại', () => engine.pause(Date.now(), null)) },
    { label: 'Tiếp tục', click: () => userAction('Tiếp tục', () => engine.resume(Date.now())) },
    { type: 'separator' },
    { label: 'Mở thư mục nhật ký', click: () => shell.showItemInFolder(logFile()) },
    { label: 'Thoát', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showMain);
}

function updateTray(st) {
  if (!tray) return;
  const mins = Math.max(1, Math.ceil(st.remainingSecs / 60));
  const text = {
    working: `StandUp — còn ${mins} phút nữa nhắc`,
    reminding: 'StandUp — đến giờ vận động!',
    breaking: `StandUp — đang nghỉ (còn ${mins} phút)`,
    idle: 'StandUp — bạn đang rời máy',
    paused: st.remainingSecs > 0
      ? `StandUp — tạm dừng (còn ${mins} phút)`
      : 'StandUp — đang tạm dừng',
  }[st.phase] || 'StandUp';
  tray.setToolTip(text);

  const [iconText, iconColor] = {
    working: [String(Math.min(99, mins)), GREEN],
    breaking: [String(Math.min(99, mins)), AMBER],
    reminding: ['!', AMBER],
    idle: ['-', GRAY],
    paused: ['P', GRAY],
  }[st.phase] || ['-', GRAY];
  // Only redraw the icon when its content changes (about once a minute) — avoids GDI churn.
  const key = `${iconText}|${iconColor.join()}`;
  if (key !== lastTrayKey) {
    lastTrayKey = key;
    tray.setImage(trayIcon(iconText, iconColor));
  }
}

// ---- Effects from the engine ----

function applyEffects(fx) {
  for (const e of fx) {
    switch (e.type) {
      case 'openReminder':
        showReminder();
        break;
      case 'closeReminder':
        if (reminderAlive()) reminderWin.hide();
        break;
      case 'openOverlay':
        showOverlay();
        break;
      case 'closeOverlay':
        hideOverlay();
        break;
      case 'sound':
        // Played in the main window's renderer (Web Audio) — works while hidden too.
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sound', e.kind);
          // Sound in a background app fails silently very easily (blocked by the
          // autoplay policy, throttled while hidden). Record whether anything
          // actually came out.
          if (process.env.STANDUP_DEBUG) {
            // Sample at several points: Chromium's audibility meter lags, and a
            // single sample gives false negatives far too often.
            for (const ms of [150, 300, 500, 700, 1000, 1400]) {
              setTimeout(() => {
                if (mainWin && !mainWin.isDestroyed()) {
                  debugLog(`sound "${e.kind}" +${ms}ms: audible = ${mainWin.webContents.isCurrentlyAudible()}`);
                }
              }, ms);
            }
          }
        }
        break;
      case 'notify':
        if (Notification.isSupported()) {
          const n = new Notification({ title: e.title, body: e.body });
          n.on('click', showReminder);
          n.show();
        }
        break;
    }
  }
}

// Run an engine action and broadcast the new state immediately (do not wait for a tick).
function act(fn) {
  applyEffects(fn());
  broadcast();
}

// Wrap an action started by the USER: log it, then run it. Any resulting phase change
// is logged separately by logPhaseChange(), so the log shows both the intent (what
// they pressed) and the outcome (how the state moved).
function userAction(label, fn) {
  logEvent('info', `Thao tác: ${label}`);
  act(fn);
}

// Log every time the engine CHANGES phase — only on change, not on every tick.
let lastLoggedPhase = null;
function logPhaseChange() {
  if (engine.phase === lastLoggedPhase) return;
  const from = lastLoggedPhase ?? '(khởi tạo)';
  const s = engine.settings;
  const detail = {
    reminding: engine.message ? ` — "${engine.message.title}"` : '',
    breaking: ` — nghỉ ${s.breakMins} phút${engine.stretch ? `, động tác "${engine.stretch.name}"` : ''}`,
    // The REAL time left until the next reminder — correct for a full cycle (~45'),
    // a manual snooze and an auto-snooze (~5') alike. Hard-coding "45 minute cycle"
    // would be a lie whenever we snoozed.
    working: ` — còn ~${Math.max(1, Math.round((engine.deadline - Date.now()) / 60_000))} phút tới lần nhắc`,
    idle: ' — người dùng rời máy',
    paused: engine.pauseUntil == null ? ' — đến khi bật lại' : ' — có hẹn giờ',
  }[engine.phase] || '';
  logEvent('info', `Trạng thái: ${from} → ${engine.phase}${detail}`);
  lastLoggedPhase = engine.phase;
}

// ---- Full-screen / presentation detection (so we do NOT pop a reminder over it) ----
// The reminder window is always-on-top and Windows does NOT suppress it the way it
// suppresses toasts — so without checking ourselves, a reminder would jump on top of
// a full-screen game, a video, or a screen-shared meeting. Ask the very API Windows
// uses to decide whether to show a toast: SHQueryUserNotificationState (only 5 = a
// normal desktop lets us pop — see notificationsAllowedFromState). We call the
// native function through PowerShell + Add-Type, the same way the app already runs
// 'reg': no extra dependency and no compiler needed at build time.
//
// Three rules that keep this check from ever harming the reminders themselves:
//   (1) ASYNC + cached — the tick reads the cache instantly and never blocks;
//   (2) THROTTLED — only ask when a reminder is close (≤15s) or already overdue, and
//       at most once every 8 seconds, so we never spawn PowerShell continuously;
//   (3) FAIL-OPEN — any trouble (error, timeout, odd number) counts as ALLOWED;
//       missing one reminder during full-screen beats silently killing reminders.
const DND_APPROACH_SECS = 15;       // only start asking within 15s of the deadline
const DND_CHECK_INTERVAL_MS = 8000; // ask at most once every 8 seconds
const DND_QUERY_TIMEOUT_MS = 8000;  // too slow to answer = treat as broken → fail-open

// Pass the C# through -EncodedCommand (base64 UTF-16LE) to sidestep every nested
// quoting problem. $ProgressPreference is off so stdout carries only the state number.
const DND_PS = [
  "$ProgressPreference='SilentlyContinue'",
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class Dnd {',
  '  [DllImport("shell32.dll")]',
  '  public static extern int SHQueryUserNotificationState(out int state);',
  '  public static int Get(){ int s; int hr = SHQueryUserNotificationState(out s); return hr==0 ? s : -1; }',
  '}',
  '"@',
  '[Dnd]::Get()',
].join('\n');
const DND_B64 = Buffer.from(DND_PS, 'utf16le').toString('base64');

let notifyAllowed = true;  // cache: is Windows currently letting us pop a reminder
let dndChecking = false;   // a query is already in flight (do not spawn on top of it)
let lastDndCheckAt = 0;    // when we last asked (for throttling)

function refreshNotifyAllowed() {
  if (process.platform !== 'win32') { notifyAllowed = true; return; }
  const now = Date.now();
  if (dndChecking || now - lastDndCheckAt < DND_CHECK_INTERVAL_MS) return;
  lastDndCheckAt = now;
  dndChecking = true;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', DND_B64],
    { timeout: DND_QUERY_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      dndChecking = false;
      const was = notifyAllowed;
      // Error/timeout → fail-open: a broken query must never disable reminders.
      notifyAllowed = err ? true : notificationsAllowedFromState(stdout);
      if (was && !notifyAllowed) {
        logEvent('info', `Windows đang bận (toàn màn hình/trình chiếu) — tạm hoãn lời nhắc tới khi rảnh [trạng thái ${String(stdout).trim()}]`);
      } else if (!was && notifyAllowed) {
        logEvent('info', 'Windows rảnh trở lại — sẽ nhắc khi tới hạn');
      }
    });
}

// ---- Tick loop & state broadcast ----

function idleSecs() {
  return powerMonitor.getSystemIdleTime();
}

function tick() {
  const now = Date.now();
  const idle = idleSecs();
  const pre = engine.status(now, idle);
  // Only ask Windows when the "hide during full-screen" feature is ON and a reminder
  // is nearly due (or already overdue) — with the feature off we ask nothing and
  // spawn nothing. refreshNotifyAllowed throttles itself, so every-tick calls are safe.
  if (engine.settings.deferFullscreen && pre.phase === 'working' && pre.remainingSecs <= DND_APPROACH_SECS) {
    refreshNotifyAllowed();
  }
  // Feature off → ALWAYS allow reminding (even in full-screen); on → follow the
  // Windows state. notifyAllowed always starts out true, so turning the feature off
  // restores the old behaviour exactly, regardless of the last query result.
  const canNotify = engine.settings.deferFullscreen ? notifyAllowed : true;
  debugLog(`${engine.phase}\tidle=${idle}\tthreshold=${engine.idleThresholdSecs()}\tcanNotify=${canNotify}\tdeferFullscreen=${engine.settings.deferFullscreen}`);
  applyEffects(engine.tick(now, idle, canNotify));
  broadcast();
}

function broadcast() {
  logPhaseChange();
  const st = engine.status(Date.now(), idleSecs());
  // Safety net: a window covering the whole screen that gets stuck effectively takes
  // the user's machine away — far worse than any other bug this app could have. The
  // close-overlay effect is already spread across every exit from a break, but here
  // we re-check against the real state every second: not on a break any more and the
  // overlay is still up → close it immediately.
  if (st.phase !== 'breaking') hideOverlay();
  for (const w of [mainWin, reminderWin, onboardWin, overlayWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('status', st);
  }
  updateTray(st);
}

// ---- IPC for the renderers ----

function wireIpc() {
  ipcMain.handle('get-status', () => engine.status(Date.now(), idleSecs()));
  ipcMain.handle('get-settings', () => ({ ...engine.settings }));
  ipcMain.handle('set-settings', (_ev, raw) => {
    // Preserve the onboarded flag — the settings screen must never re-trigger onboarding.
    const s = clampSettings({ ...raw, onboarded: engine.settings.onboarded });
    engine.updateSettings(Date.now(), s);
    saveSettings(s);
    applyAutoStart(s.autoStart);
    logEvent('info', `Đổi cài đặt — chu kỳ=${s.intervalMins}', nghỉ=${s.breakMins}', rời máy=${s.idleMins}', âm=${s.sound}, tự khởi động=${s.autoStart}, vị trí nhắc=${s.reminderPosition}, ẩn khi full=${s.deferFullscreen}, màn nghỉ=${s.breakOverlay}`);
    broadcast();
    return s;
  });
  // The renderer needs to know whether this is a packaged or a dev build so it can
  // show the right note about "start with Windows" (a dev build writes no startup entry).
  ipcMain.handle('get-env', () => ({ packaged: app.isPackaged }));
  ipcMain.handle('complete-onboarding', (_ev, raw) => {
    const now = Date.now();
    const s = clampSettings({ ...engine.settings, ...raw, onboarded: true });
    engine.updateSettings(now, s);
    engine.newCycle(now); // start counting afresh with the interval just chosen
    saveSettings(s);
    applyAutoStart(s.autoStart);
    logEvent('info', `Hoàn tất onboarding — chu kỳ=${s.intervalMins}', tự khởi động=${s.autoStart}, âm=${s.sound}`);
    if (onboardWin && !onboardWin.isDestroyed()) onboardWin.close();
    broadcast();
    if (Notification.isSupported()) {
      new Notification({
        title: 'StandUp đang chạy 🧍',
        body: `Đã bắt đầu đếm. Cứ ${s.intervalMins} phút mình sẽ nhắc bạn đứng dậy nhé.`,
      }).show();
    }
    return s;
  });
  ipcMain.on('action', (_ev, name) => {
    const now = Date.now();
    // [log label, function to run] — the label records what the user pressed.
    const actions = {
      takeBreak: ['Nghỉ ngay', () => engine.takeBreak(now)],
      snooze: ['Hoãn 5 phút', () => engine.snooze(now)],
      skip: ['Bỏ qua', () => engine.skip(now)],
      breakNow: ['Nghỉ ngay', () => engine.breakNow(now)],
      test: ['Thử nhắc', () => engine.triggerReminder(now)],
      pauseIndef: ['Tạm dừng đến khi bật lại', () => engine.pause(now, null)],
      pause1h: ['Tạm dừng 1 giờ', () => engine.pause(now, 60)],
      resume: ['Tiếp tục', () => engine.resume(now)],
    };
    const a = actions[name];
    if (a) userAction(a[0], a[1]);
  });
  // The user pressed the gear to expand/collapse the settings → resize the window to fit.
  ipcMain.on('toggle-settings', (_ev, open) => {
    settingsOpen = !!open;
    fitMain();
  });
}

// ---- Startup ----

// Allow a single instance only — launching again surfaces the running instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Install crash logging FIRST — before any window exists — so failures during
  // startup make it into the log too.
  installCrashLogging();

  // The alert sound is synthesised with Web Audio and is not triggered by a user
  // gesture — Chromium blocks autoplay without this switch.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  app.on('second-instance', showMain);

  // The two window 'close' handlers block closing so the app survives in the tray;
  // the isQuitting flag is the only way out. It used to be lowered only by the Quit
  // menu item, so every other exit path — Windows logoff, shutdown, app.quit() from
  // elsewhere — was held back by the app until the OS forced it down.
  app.on('before-quit', () => {
    app.isQuitting = true;
    logEvent('info', 'Thoát app');
  });

  app.whenReady().then(() => {
    // Windows needs an AppUserModelID for toasts to display; when not packaged,
    // using the exe path is what Electron recommends for dev mode.
    app.setAppUserModelId(app.isPackaged ? AUMID : process.execPath);
    registerAumid();

    engine = new Engine(loadSettings(), Date.now());
    const cfg = engine.settings;
    logEvent('info', `Khởi động — đóng gói=${app.isPackaged}, ẩn=${startHidden}, chu kỳ=${cfg.intervalMins}', nghỉ=${cfg.breakMins}', rời máy=${cfg.idleMins}', âm=${cfg.sound}, tự khởi động=${cfg.autoStart}, vị trí nhắc=${cfg.reminderPosition}, ẩn khi full=${cfg.deferFullscreen}, màn nghỉ=${cfg.breakOverlay}, onboarded=${cfg.onboarded}`);
    // The startup entry can vanish outside the app's control — an old build's
    // uninstaller removing it during an over-install is a case we hit for real. And
    // the app only writes that entry when the user presses Save, so the UI would
    // keep "Start with Windows" ticked long after it had actually been turned off.
    // Re-assert it on every run; setLoginItemSettings is idempotent, so a redundant
    // call is harmless.
    applyAutoStart(engine.settings.autoStart);
    createWindows();
    if (!engine.settings.onboarded) createOnboarding();
    createTray();
    wireIpc();

    setInterval(tick, 1000);
    // Waking from sleep → tick immediately so the engine handles the time gap.
    powerMonitor.on('resume', () => { logEvent('info', 'Máy thức dậy sau khi ngủ'); tick(); });
    powerMonitor.on('suspend', () => logEvent('info', 'Máy chuẩn bị ngủ'));
  });

  // Tray app: do not quit when every window is hidden or closed.
  app.on('window-all-closed', () => {});
}
