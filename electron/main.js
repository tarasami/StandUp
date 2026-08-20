// StandUp — main process: tray, cửa sổ, thông báo, idle detection, vòng tick 1s.
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

// Khi Windows tự chạy app lúc đăng nhập, không bung cửa sổ ra giữa màn hình.
const startHidden = process.argv.includes('--hidden');

// ---- Cài đặt (JSON trong thư mục userData) ----

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const parsed = parseSettingsJson(fs.readFileSync(settingsFile(), 'utf8'));
    if (parsed) return clampSettings(parsed);
  } catch { /* chưa có file — lần chạy đầu tiên */ }
  // File hỏng cũng rơi về đây: thà chạy với mặc định còn hơn không chạy.
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  try {
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Ghi ra file tạm rồi đổi tên: rename trong cùng thư mục là thao tác nguyên
    // tử, nên crash hay mất điện giữa chừng cũng không để lại JSON cụt. Ghi đè
    // thẳng thì một file cụt sẽ khiến loadSettings lặng lẽ quay về mặc định —
    // mất sạch cài đặt và bắt người dùng onboarding lại từ đầu.
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Không lưu được cài đặt:', err);
    logEvent('error', `Không lưu được cài đặt: ${err.message}`);
  }
}

// App chạy nền trong tray rất khó quan sát khi có sự cố. Đặt biến môi trường
// STANDUP_DEBUG=<đường dẫn file> để ghi vết CHI TIẾT (mỗi tick 1 dòng: trạng
// thái, idle, ngưỡng) mà không cần mở DevTools. Chỉ dùng lúc gỡ lỗi sâu.
function debugLog(line) {
  if (!process.env.STANDUP_DEBUG) return;
  try {
    fs.appendFileSync(process.env.STANDUP_DEBUG, `${new Date().toISOString()}\t${line}\n`);
  } catch { /* nhật ký hỏng không được làm chết app */ }
}

// ---- Nhật ký sự kiện (LUÔN BẬT) ----
// Khác debugLog: nhật ký này luôn ghi, nhưng CHỈ các sự kiện đáng chú ý (khởi
// động, đổi trạng thái, thao tác người dùng, đổi cài đặt, lỗi, ngủ/thức, thoát)
// vào userData/standup.log, để soi lại khi người dùng báo sự cố. Ba nguyên tắc
// "chắc chắn": (1) ghi đồng bộ để không mất sự kiện lúc crash; (2) xoay vòng để
// không bao giờ phình đầy đĩa; (3) bọc try/catch để ghi lỗi không làm chết app.
const LOG_MAX_BYTES = 1_000_000; // ~1 MB rồi đẩy sang standup.log.1 (tối đa ~2 MB)

function logFile() {
  return path.join(app.getPath('userData'), 'standup.log');
}

function logEvent(level, message) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (shouldRotateLog(fs.statSync(file).size, LOG_MAX_BYTES)) {
        // rename không đè được file đang tồn tại trên Windows → dọn .1 cũ trước.
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
    } catch { /* chưa có file — lần ghi đầu, khỏi xoay vòng */ }
    fs.appendFileSync(file, `${formatLogLine(new Date(), level, message)}\n`);
  } catch { /* nhật ký hỏng KHÔNG được làm chết app */ }
}

// ---- Bắt sự cố ngoài dự tính vào nhật ký ----
// Nhật ký ở trên chỉ ghi các sự kiện CÓ TRẬT TỰ. Nhưng thứ cần nhất khi "app tự
// nhiên hỏng" lại là những cú ngã ngoài dự tính: lỗi không bắt trong main
// process, promise bị bỏ rơi, hay renderer (nơi phát âm báo + vẽ cửa sổ) chết —
// không bắt thì chúng biến mất không dấu vết. Ở đây CHỦ ĐÍCH ghi log rồi cố giữ
// app sống tiếp: đây là app chạy nền trong tray, thà nhắc tiếp còn hơn tự tắt vì
// một lỗi thoáng qua. Đánh đổi: đăng ký uncaughtException khiến hộp thoại lỗi
// mặc định của Electron im đi — nhưng một hộp thoại "JavaScript error" nhiện lên
// giữa màn hình còn tệ hơn cho app nền; ta đổi nó lấy một dòng trong standup.log.
function installCrashLogging() {
  process.on('uncaughtException', (err, origin) => {
    logEvent('error', `Lỗi không bắt (${origin}): ${err && err.stack ? err.stack : err}`);
  });
  process.on('unhandledRejection', (reason) => {
    logEvent('error', `Promise bị bỏ rơi: ${reason && reason.stack ? reason.stack : reason}`);
  });
  // Một handler ở tầng app bắt được renderer của MỌI cửa sổ. Renderer cửa sổ
  // chính chết = mất âm báo + mất popup nhắc — đúng lớp lỗi "thông báo biến mất".
  app.on('render-process-gone', (_ev, contents, details) => {
    const which = mainWin && contents === mainWin.webContents ? 'cửa sổ chính'
      : reminderWin && contents === reminderWin.webContents ? 'cửa sổ nhắc'
      : onboardWin && contents === onboardWin.webContents ? 'onboarding'
      : overlayWin && contents === overlayWin.webContents ? 'màn nghỉ'
      : 'renderer';
    logEvent('error', `Renderer chết — ${which}: lý do=${details.reason}, mã thoát=${details.exitCode}`);
  });
  // Tiến trình con (GPU, tiện ích…) chết: thường vô hại, nhưng GPU chết có thể
  // làm mất hình/âm nên vẫn ghi lại để đối chiếu khi có sự cố.
  app.on('child-process-gone', (_ev, details) => {
    const name = details.name ? ` ${details.name}` : '';
    logEvent('error', `Tiến trình con chết — ${details.type}${name}: lý do=${details.reason}, mã thoát=${details.exitCode}`);
  });
}

// Đăng ký AUMID qua registry để toast hiện banner ổn định. Shortcut Start Menu
// (cơ chế cổ điển mà installer tạo) không đủ tin cậy: đã kiểm chứng trên máy
// thật trường hợp toast chỉ vào Action Center mà không bật banner cho tới khi
// có khoá này. Ghi mỗi lần khởi động — thao tác idempotent, HKCU không cần quyền
// admin. Uninstaller dọn khoá này (build/installer.nsh).
function registerAumid() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;
  try {
    // REG_EXPAND_SZ chứ không phải REG_SZ — một số bản Windows chỉ đọc
    // DisplayName cho banner ở kiểu này.
    execFileSync('reg', ['add', key, '/v', 'DisplayName', '/t', 'REG_EXPAND_SZ', '/d', 'StandUp', '/f'], { windowsHide: true });
    // IconUri phải là đường dẫn tới FILE ẢNH. Trước đây chỗ này trỏ vào .exe —
    // shell của Windows không rút được icon từ đó, mà cũng không đọc nổi
    // assets/icon.png vì nó nằm bên trong app.asar. Nay electron-builder chép
    // icon.png ra thẳng resources/ (xem extraResources trong package.json).
    const iconPath = path.join(process.resourcesPath, 'icon.png');
    if (fs.existsSync(iconPath)) {
      execFileSync('reg', ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f'], { windowsHide: true });
    } else {
      // Thà không có IconUri còn hơn để lại giá trị hỏng từ bản cũ: Windows
      // sẽ tự lùi về icon mặc định thay vì cố đọc một đường dẫn vô nghĩa.
      try {
        execFileSync('reg', ['delete', key, '/v', 'IconUri', '/f'], { windowsHide: true });
      } catch { /* chưa từng có giá trị này thì thôi */ }
    }
  } catch (err) {
    console.error('Không đăng ký được AUMID cho toast:', err);
    logEvent('error', `Không đăng ký được AUMID: ${err.message}`);
  }
}

// Người dùng đã bấm ⚙ để xổ phần cài đặt ra chưa. Renderer là nơi quyết định
// (bấm nút), báo về đây để cửa sổ co/giãn cho vừa — xem fitMain().
let settingsOpen = false;

// ---- Khởi động cùng Windows ----

// Chỉ ghi mục khởi động khi app ĐÃ ĐÓNG GÓI. Bản dev trỏ vào electron.exe trong
// node_modules — xoá node_modules sẽ để lại một mục khởi động chết trong registry.
function applyAutoStart(enabled) {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (err) {
    console.error('Không đặt được khởi động cùng Windows:', err);
    logEvent('error', `Không đặt được autostart: ${err.message}`);
  }
}

// ---- Cửa sổ ----

// Cửa sổ chính co/giãn theo một trục: cài đặt đóng (chỉ trạng thái + nút) hay mở
// (bấm ⚙ xổ cài đặt ra). Hai chiều cao đo thật bằng DevTools (viền cửa sổ Windows
// chiếm 39px). Cắt vừa khít nội dung: dư thì thừa khoảng trống, thiếu thì nút bị
// khuất + sinh thanh cuộn.
const HEIGHTS = {
  compact: 384, // đóng — nội dung 331px, chỉ trạng thái + 2 nút + ⚙
  full: 864,    // mở cài đặt — đo thật 824px nội dung + 39px viền = 863
};

function createWindows() {
  mainWin = new BrowserWindow({
    width: 420,
    height: HEIGHTS.compact, // mở ra ở dạng gọn; xổ cài đặt thì tự cao lên
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    show: false, // chỉ hiện khi nội dung sẵn sàng — tránh nháy khung trắng
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Cửa sổ này phát âm báo kể cả khi đang ẩn trong tray → không cho throttle.
      backgroundThrottling: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  // Chuyển log của renderer vào nhật ký chẩn đoán — cửa sổ này thường bị ẩn,
  // không mở được DevTools để xem lỗi.
  mainWin.webContents.on('console-message', (...args) => {
    const d = args[0];
    debugLog(`renderer: ${d && typeof d === 'object' && d.message ? d.message : args[2]}`);
  });
  mainWin.once('ready-to-show', () => {
    // Lần chạy đầu thì onboarding hiện trước; autostart thì nằm im trong tray.
    if (!startHidden && engine.settings.onboarded) mainWin.show();
  });
  // Đóng cửa sổ = thu về tray, app vẫn chạy nền.
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

  // Màn nghỉ che màn hình. Dựng sẵn từ đầu (ẩn) chứ không tạo mới mỗi lần nghỉ:
  // tạo cửa sổ mất cả trăm ms và nháy khung trắng, rất lộ khi nó chiếm cả màn hình.
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    // Không dùng setFullScreen: trên Windows nó chạy hoạt ảnh chuyển desktop,
    // chậm và giật. Tự đặt bounds đúng bằng màn hình vừa nhanh vừa gọn.
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    // Nền trong mờ, thấy được công việc phía sau (màu thật nằm ở CSS).
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
  // Đo theo màn hình đang chứa cửa sổ, không phải màn hình chính: máy nhiều màn
  // hình rất hay có một cái thấp hơn hẳn.
  const wa = screen.getDisplayMatching(mainWin.getBounds()).workArea;
  const want = mainWindowHeight(settingsOpen, wa.height, HEIGHTS);
  const b = mainWin.getBounds();
  // Đổi CẢ vị trí chứ không chỉ chiều cao: cửa sổ giãn xuống dưới, đang ở giữa
  // màn hình mà xổ cài đặt ra là đáy thò khỏi màn hình, nuốt mất nút Lưu.
  const y = clampWindowY(b.y, want, wa);
  if (b.height === want && b.y === y) return;
  // Trên Windows, setSize/setBounds bị bỏ qua với cửa sổ resizable:false → mở khoá tạm.
  mainWin.setResizable(true);
  mainWin.setBounds({ x: b.x, y, width: b.width, height: want });
  mainWin.setResizable(false);
}

// Effect từ engine (và cả cú bấm vào toast) có thể tới đúng lúc app đang thoát,
// khi cửa sổ nhắc đã bị huỷ — chạm vào nó lúc đó là làm chết main process.
// Mọi thao tác với cửa sổ nhắc phải đi qua hai hàm dưới đây.
function reminderAlive() {
  return reminderWin && !reminderWin.isDestroyed();
}

function showReminder() {
  if (!reminderAlive()) return;
  // Bung ra ở màn hình đang có con trỏ chuột — tức màn hình người dùng đang làm
  // việc. Dùng màn hình chính thì trên máy nhiều màn hình lời nhắc sẽ hiện ở
  // một chỗ khác hẳn nơi người dùng đang nhìn, coi như không nhắc.
  // workArea đã trừ sẵn taskbar; góc dưới-phải hay giữa là do người dùng chọn.
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { x, y } = reminderXY(engine.settings.reminderPosition, wa, reminderWin.getBounds());
  reminderWin.setPosition(x, y);
  // showInactive: hiện cửa sổ nhưng KHÔNG cướp focus — không phá gõ phím.
  // Nhưng showInactive chỉ đặt cửa sổ vào ĐÚNG CHỖ CŨ trong nhóm always-on-top,
  // nên vẫn có thể nằm dưới một cửa sổ always-on-top khác (đã đo: hạng 1, dưới
  // thanh taskbar). moveTop() nâng hẳn lên đỉnh nhóm mà vẫn không cướp focus.
  reminderWin.showInactive();
  reminderWin.moveTop();
}

function overlayAlive() {
  return overlayWin && !overlayWin.isDestroyed();
}

function showOverlay() {
  if (!overlayAlive()) return;
  // Phủ trọn màn hình người dùng đang làm việc (theo con trỏ, như cửa sổ nhắc).
  // Dùng bounds chứ không workArea: có chừa taskbar ra thì màn nghỉ trông như một
  // cửa sổ to đùng, và người dùng bấm luôn sang app khác — mất tác dụng.
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  overlayWin.setBounds({ x: d.x, y: d.y, width: d.width, height: d.height });
  // Khác cửa sổ nhắc (showInactive, tránh cướp focus lúc đang gõ): màn nghỉ PHẢI
  // nhận focus, vì người dùng vừa tự bấm "Nghỉ ngay" và phím Esc chỉ chạy khi
  // cửa sổ đang được focus.
  overlayWin.show();
  overlayWin.focus();
  overlayWin.moveTop();
}

function hideOverlay() {
  if (overlayAlive() && overlayWin.isVisible()) overlayWin.hide();
}

// Lần chạy đầu: một màn hình duy nhất, chọn khoảng nhắc rồi bắt đầu.
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
  // Chưa qua onboarding thì luôn đưa người dùng về màn hình đó trước.
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

// Vẽ icon tray động: số phút còn lại (hoặc ký hiệu trạng thái) trên nền màu.
// Font pixel 3×5 phóng đôi trong khung 16×16 — đủ đọc ở khay hệ thống.
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
  P: ['#.#', '#.#', '#.#', '#.#', '#.#'], // ký hiệu tạm dừng ‖
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
  // Nền: hình vuông cắt chéo góc 2px cho mềm mắt.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (Math.min(x, S - 1 - x) + Math.min(y, S - 1 - y) >= 2) put(x, y, [r, g, b]);
    }
  }
  // Chữ trắng, căn giữa.
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
  // Chỉ vẽ lại icon khi nội dung đổi (mỗi phút một lần) — tránh churn GDI.
  const key = `${iconText}|${iconColor.join()}`;
  if (key !== lastTrayKey) {
    lastTrayKey = key;
    tray.setImage(trayIcon(iconText, iconColor));
  }
}

// ---- Effect từ engine ----

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
        // Phát trong renderer cửa sổ chính (Web Audio) — chạy cả khi cửa sổ ẩn.
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sound', e.kind);
          // Âm báo ở app chạy nền rất dễ hỏng thầm lặng (bị autoplay chặn, bị
          // throttle khi ẩn). Ghi lại xem thực tế có tiếng ra hay không.
          if (process.env.STANDUP_DEBUG) {
            // Lấy mẫu nhiều mốc: bộ đo độ ồn của Chromium có độ trễ, một mốc
            // duy nhất rất dễ cho kết quả âm tính giả.
            for (const ms of [150, 300, 500, 700, 1000, 1400]) {
              setTimeout(() => {
                if (mainWin && !mainWin.isDestroyed()) {
                  debugLog(`am bao "${e.kind}" +${ms}ms: co tieng ra = ${mainWin.webContents.isCurrentlyAudible()}`);
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

// Chạy một hành động trên engine rồi phát trạng thái mới ngay (không đợi tick).
function act(fn) {
  applyEffects(fn());
  broadcast();
}

// Bọc một thao tác do NGƯỜI DÙNG khởi xướng: ghi nhật ký rồi chạy. Việc đổi
// trạng thái kéo theo sẽ được logPhaseChange() ghi riêng, nên nhật ký cho thấy
// cả ý định (bấm gì) lẫn kết quả (trạng thái chuyển thế nào).
function userAction(label, fn) {
  logEvent('info', `Thao tác: ${label}`);
  act(fn);
}

// Ghi mỗi lần engine ĐỔI trạng thái — chỉ khi khác đi, không phải mỗi tick.
let lastLoggedPhase = null;
function logPhaseChange() {
  if (engine.phase === lastLoggedPhase) return;
  const from = lastLoggedPhase ?? '(khởi tạo)';
  const s = engine.settings;
  const detail = {
    reminding: engine.message ? ` — "${engine.message.title}"` : '',
    breaking: ` — nghỉ ${s.breakMins} phút${engine.stretch ? `, động tác "${engine.stretch.name}"` : ''}`,
    // Thời gian còn lại THẬT tới lần nhắc kế — đúng cho cả chu kỳ đầy đủ (~45'),
    // hoãn tay và tự-hoãn (~5'). Ghi "chu kỳ 45 phút" cứng sẽ nói dối lúc hoãn.
    working: ` — còn ~${Math.max(1, Math.round((engine.deadline - Date.now()) / 60_000))} phút tới lần nhắc`,
    idle: ' — người dùng rời máy',
    paused: engine.pauseUntil == null ? ' — đến khi bật lại' : ' — có hẹn giờ',
  }[engine.phase] || '';
  logEvent('info', `Trạng thái: ${from} → ${engine.phase}${detail}`);
  lastLoggedPhase = engine.phase;
}

// ---- Phát hiện toàn màn hình / trình chiếu (để KHÔNG bung lời nhắc đè lên) ----
// Cửa sổ nhắc là always-on-top mà Windows KHÔNG tự nén như toast — nên nếu không
// tự kiểm, lời nhắc sẽ nhảy đè lên game full-screen, video, hay lúc họp chia sẻ
// màn hình. Hỏi chính API mà Windows dùng để quyết định có hiện toast không:
// SHQueryUserNotificationState (chỉ 5 = desktop bình thường mới bung — xem
// notificationsAllowedFromState). Gọi native qua PowerShell + Add-Type, giống
// cách app chạy 'reg': không thêm phụ thuộc, không cần trình biên dịch lúc build.
//
// Ba nguyên tắc để việc hỏi han này KHÔNG bao giờ hại tính năng nhắc:
//   (1) BẤT ĐỒNG BỘ + có cache — tick đọc cache tức thì, không bao giờ bị chặn;
//   (2) TIẾT LƯU — chỉ hỏi khi lời nhắc sắp tới (≤15s) hoặc đang quá hạn chờ, và
//       nhiều nhất mỗi 8 giây một lần, để không spawn PowerShell liên tục;
//   (3) FAIL-OPEN — mọi trục trặc (lỗi, timeout, số lạ) đều coi như ĐƯỢC PHÉP,
//       thà lỡ nhắc lúc full-screen còn hơn im lặng tắt hẳn tính năng nhắc.
const DND_APPROACH_SECS = 15;       // chỉ bắt đầu hỏi khi còn ≤15s nữa là tới giờ
const DND_CHECK_INTERVAL_MS = 8000; // hỏi nhiều nhất mỗi 8 giây
const DND_QUERY_TIMEOUT_MS = 8000;  // hỏi quá lâu = coi như hỏng → fail-open

// Truyền C# qua -EncodedCommand (base64 UTF-16LE) để né sạch mọi rắc rối trích
// dẫn lồng nhau. $ProgressPreference tắt để stdout chỉ còn đúng con số trạng thái.
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

let notifyAllowed = true;  // cache: Windows có đang cho phép bung lời nhắc không
let dndChecking = false;   // đang có một truy vấn chạy dở (đừng spawn chồng)
let lastDndCheckAt = 0;    // mốc lần hỏi gần nhất (để tiết lưu)

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
      // Lỗi/timeout → fail-open: không để việc hỏi hỏng làm tắt tính năng nhắc.
      notifyAllowed = err ? true : notificationsAllowedFromState(stdout);
      if (was && !notifyAllowed) {
        logEvent('info', `Windows đang bận (toàn màn hình/trình chiếu) — tạm hoãn lời nhắc tới khi rảnh [trạng thái ${String(stdout).trim()}]`);
      } else if (!was && notifyAllowed) {
        logEvent('info', 'Windows rảnh trở lại — sẽ nhắc khi tới hạn');
      }
    });
}

// ---- Vòng tick & phát trạng thái ----

function idleSecs() {
  return powerMonitor.getSystemIdleTime();
}

function tick() {
  const now = Date.now();
  const idle = idleSecs();
  const pre = engine.status(now, idle);
  // Chỉ hỏi Windows khi tính năng "ẩn khi full màn hình" đang BẬT và lời nhắc sắp
  // tới (hoặc đang quá hạn chờ) — tắt tính năng thì khỏi hỏi, khỏi spawn gì.
  // refreshNotifyAllowed tự tiết lưu nên gọi mỗi tick vô hại.
  if (engine.settings.deferFullscreen && pre.phase === 'working' && pre.remainingSecs <= DND_APPROACH_SECS) {
    refreshNotifyAllowed();
  }
  // Tắt tính năng → LUÔN cho nhắc (kể cả full màn hình); bật → theo trạng thái
  // Windows. Bao giờ notifyAllowed cũng bắt đầu là true nên tắt tính năng là về
  // đúng hành vi cũ, không phụ thuộc lần hỏi gần nhất.
  const canNotify = engine.settings.deferFullscreen ? notifyAllowed : true;
  debugLog(`${engine.phase}\tidle=${idle}\tnguong=${engine.idleThresholdSecs()}\tnhac_duoc=${canNotify}\tan_full=${engine.settings.deferFullscreen}`);
  applyEffects(engine.tick(now, idle, canNotify));
  broadcast();
}

function broadcast() {
  logPhaseChange();
  const st = engine.status(Date.now(), idleSecs());
  // Lưới đỡ: một cửa sổ che kín màn hình mà kẹt lại thì người dùng coi như mất
  // máy — hậu quả nặng hơn hẳn mọi lỗi khác của app này. Effect đóng overlay đã
  // rải ở mọi lối ra khỏi giờ nghỉ, nhưng ở đây kiểm lại theo trạng thái thật
  // mỗi giây: không còn nghỉ mà overlay còn hiện thì đóng ngay.
  if (st.phase !== 'breaking') hideOverlay();
  for (const w of [mainWin, reminderWin, onboardWin, overlayWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('status', st);
  }
  updateTray(st);
}

// ---- IPC cho renderer ----

function wireIpc() {
  ipcMain.handle('get-status', () => engine.status(Date.now(), idleSecs()));
  ipcMain.handle('get-settings', () => ({ ...engine.settings }));
  ipcMain.handle('set-settings', (_ev, raw) => {
    // Giữ nguyên cờ onboarded — màn hình cài đặt không được phép bật lại onboarding.
    const s = clampSettings({ ...raw, onboarded: engine.settings.onboarded });
    engine.updateSettings(Date.now(), s);
    saveSettings(s);
    applyAutoStart(s.autoStart);
    logEvent('info', `Đổi cài đặt — chu kỳ=${s.intervalMins}', nghỉ=${s.breakMins}', rời máy=${s.idleMins}', âm=${s.sound}, tự khởi động=${s.autoStart}, vị trí nhắc=${s.reminderPosition}, ẩn khi full=${s.deferFullscreen}, màn nghỉ=${s.breakOverlay}`);
    broadcast();
    return s;
  });
  // Renderer cần biết đang chạy bản đóng gói hay bản dev để hiển thị đúng ghi chú
  // về mục "khởi động cùng Windows" (bản dev không ghi mục khởi động).
  ipcMain.handle('get-env', () => ({ packaged: app.isPackaged }));
  ipcMain.handle('complete-onboarding', (_ev, raw) => {
    const now = Date.now();
    const s = clampSettings({ ...engine.settings, ...raw, onboarded: true });
    engine.updateSettings(now, s);
    engine.newCycle(now); // đếm lại từ đầu với khoảng vừa chọn
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
    // [nhãn nhật ký, hàm chạy] — nhãn để ghi lại người dùng đã bấm gì.
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
  // Người dùng bấm ⚙ xổ/thu phần cài đặt → co giãn cửa sổ cho vừa.
  ipcMain.on('toggle-settings', (_ev, open) => {
    settingsOpen = !!open;
    fitMain();
  });
}

// ---- Khởi động ----

// Chỉ cho chạy 1 instance — mở lần 2 thì hiện cửa sổ của instance đang chạy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Cắm bắt-sự-cố NGAY từ đầu — trước cả khi dựng cửa sổ — để lỗi lúc khởi động
  // cũng vào được nhật ký.
  installCrashLogging();

  // Âm báo được tổng hợp bằng Web Audio, không do người dùng bấm nút — Chromium
  // chặn phát tự động nếu thiếu switch này.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  app.on('second-instance', showMain);

  // Hai handler 'close' của cửa sổ chặn việc đóng để app sống tiếp trong tray;
  // cờ isQuitting là lối thoát duy nhất. Trước đây chỉ menu Thoát mới hạ cờ,
  // nên mọi đường thoát khác — Windows logoff, shutdown, app.quit() từ chỗ
  // khác — đều bị app giữ lại cho tới khi hệ điều hành cưỡng bức tắt.
  app.on('before-quit', () => {
    app.isQuitting = true;
    logEvent('info', 'Thoát app');
  });

  app.whenReady().then(() => {
    // Windows cần AppUserModelID để toast hiển thị; khi chưa đóng gói,
    // dùng đường dẫn exe là cách được Electron khuyến nghị cho chế độ dev.
    app.setAppUserModelId(app.isPackaged ? AUMID : process.execPath);
    registerAumid();

    engine = new Engine(loadSettings(), Date.now());
    const cfg = engine.settings;
    logEvent('info', `Khởi động — đóng gói=${app.isPackaged}, ẩn=${startHidden}, chu kỳ=${cfg.intervalMins}', nghỉ=${cfg.breakMins}', rời máy=${cfg.idleMins}', âm=${cfg.sound}, tự khởi động=${cfg.autoStart}, vị trí nhắc=${cfg.reminderPosition}, ẩn khi full=${cfg.deferFullscreen}, màn nghỉ=${cfg.breakOverlay}, onboarded=${cfg.onboarded}`);
    // Mục khởi động có thể biến mất ngoài tầm kiểm soát của app — uninstaller
    // của bản cũ xoá nó khi cài đè là trường hợp đã gặp thật. App lại chỉ ghi
    // mục này lúc người dùng bấm Lưu, nên giao diện cứ tick "Khởi động cùng
    // Windows" trong khi thực tế đã tắt từ lâu. Đối chiếu lại mỗi lần chạy;
    // setLoginItemSettings là thao tác idempotent nên gọi thừa cũng vô hại.
    applyAutoStart(engine.settings.autoStart);
    createWindows();
    if (!engine.settings.onboarded) createOnboarding();
    createTray();
    wireIpc();

    setInterval(tick, 1000);
    // Tỉnh dậy sau sleep → tick ngay để engine xử lý khoảng trống thời gian.
    powerMonitor.on('resume', () => { logEvent('info', 'Máy thức dậy sau khi ngủ'); tick(); });
    powerMonitor.on('suspend', () => logEvent('info', 'Máy chuẩn bị ngủ'));
  });

  // App tray: không thoát khi mọi cửa sổ bị ẩn/đóng.
  app.on('window-all-closed', () => {});
}
