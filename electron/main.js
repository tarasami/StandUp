// StandUp — main process: tray, cửa sổ, thông báo, idle detection, vòng tick 1s.
const {
  app, BrowserWindow, Tray, Menu, Notification,
  powerMonitor, ipcMain, nativeImage, screen, shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile, execFileSync } = require('node:child_process');
const { Engine, DEFAULT_SETTINGS, clampSettings } = require('./engine');
const { parseRegDword, parseSettingsJson, mainWindowHeight, reminderXY } = require('./main-utils');

const AUMID = 'vn.standup.app';

let engine;
let tray = null;
let mainWin = null;
let reminderWin = null;
let onboardWin = null;

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
  }
}

// App chạy nền trong tray rất khó quan sát khi có sự cố. Đặt biến môi trường
// STANDUP_DEBUG=<đường dẫn file> để ghi nhật ký mà không cần mở DevTools.
function debugLog(line) {
  if (!process.env.STANDUP_DEBUG) return;
  try {
    fs.appendFileSync(process.env.STANDUP_DEBUG, `${new Date().toISOString()}\t${line}\n`);
  } catch { /* nhật ký hỏng không được làm chết app */ }
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
  }
}

// ---- Windows có đang nuốt toast của mình không? ----

// Đây là kiểu hỏng CÂM nguy hiểm nhất với app nhắc nhở: người dùng tắt thông báo
// của StandUp trong Settings thì Notification.isSupported() vẫn trả về true,
// n.show() vẫn chạy trơn tru, nhưng không có gì hiện lên và app không hề biết.
// Đã xảy ra thật và kéo dài 3 ngày. Đọc thẳng registry để phát hiện và nói ra.
const TOAST_SWITCHES = {
  system: ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled'],
  app: [`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${AUMID}`, 'Enabled'],
};

// null = không bị chặn. 'system' = tắt toàn máy, 'app' = chỉ tắt riêng StandUp.
let toastBlocked = null;

// Người dùng đã bấm ⚙ để xổ phần cài đặt ra chưa. Renderer là nơi quyết định
// (bấm nút), báo về đây để cửa sổ co/giãn cho vừa — xem fitMain().
let settingsOpen = false;

// REG_DWORD 0 nghĩa là TẮT. Khoá không tồn tại nghĩa là chưa ai đụng tới, tức
// đang BẬT theo mặc định — nên `reg query` lỗi là chuyện bình thường, không log.
function regDwordIsZero(keyPath, valueName) {
  return new Promise((resolve) => {
    execFile('reg', ['query', keyPath, '/v', valueName], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(parseRegDword(stdout) === 0);
    });
  });
}

async function refreshToastBlocked() {
  if (process.platform !== 'win32') return;
  let next = null;
  if (process.env.STANDUP_FORCE_TOAST_BLOCKED) {
    // Bản dev dùng AUMID là đường dẫn exe nên không có khoá registry tương ứng.
    // Cờ này để kiểm thử giao diện cảnh báo mà không phải đụng vào cài đặt máy.
    next = process.env.STANDUP_FORCE_TOAST_BLOCKED === 'system' ? 'system' : 'app';
  } else if (await regDwordIsZero(...TOAST_SWITCHES.system)) {
    next = 'system';
  } else if (app.isPackaged && await regDwordIsZero(...TOAST_SWITCHES.app)) {
    next = 'app';
  }
  if (next === toastBlocked) return;
  toastBlocked = next;
  debugLog(`toast bi chan = ${next ?? 'khong'}`);
  fitMain();
  broadcast();
}

// ---- Khởi động cùng Windows ----

// Chỉ ghi mục khởi động khi app ĐÃ ĐÓNG GÓI. Bản dev trỏ vào electron.exe trong
// node_modules — xoá node_modules sẽ để lại một mục khởi động chết trong registry.
function applyAutoStart(enabled) {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
  } catch (err) {
    console.error('Không đặt được khởi động cùng Windows:', err);
  }
}

// ---- Cửa sổ ----

// Cửa sổ chính co/giãn theo hai trục: cài đặt đóng (chỉ trạng thái + nút) hay mở
// (bấm ⚙ xổ cài đặt ra), và có dải cảnh báo "Windows chặn thông báo" hay không.
// Bốn chiều cao đo thật bằng DevTools (viền cửa sổ Windows chiếm 39px). Cắt vừa
// khít nội dung: dư thì thừa khoảng trống, thiếu thì nút bị khuất + sinh cuộn.
const HEIGHTS = {
  compact: 384,      // đóng, không cảnh báo — nội dung 331px, chỉ trạng thái + 2 nút + ⚙
  compactWarn: 520,  // đóng, có cảnh báo — nội dung 464px
  full: 750,         // mở cài đặt, không cảnh báo — nội dung 697px
  fullWarn: 880,     // mở cài đặt, có cảnh báo — nội dung 812px
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
}

function fitMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  // Đo theo màn hình đang chứa cửa sổ, không phải màn hình chính: máy nhiều màn
  // hình rất hay có một cái thấp hơn hẳn.
  const maxH = screen.getDisplayMatching(mainWin.getBounds()).workArea.height;
  const want = mainWindowHeight(settingsOpen, toastBlocked, maxH, HEIGHTS);
  const [w, h] = mainWin.getSize();
  if (h === want) return;
  // Trên Windows, setSize bị bỏ qua với cửa sổ resizable:false → mở khoá tạm.
  mainWin.setResizable(true);
  mainWin.setSize(w, want);
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
    { label: 'Nghỉ ngay', click: () => act(() => engine.breakNow(Date.now())) },
    { label: 'Thử nhắc nhở', click: () => act(() => engine.triggerReminder()) },
    { type: 'separator' },
    { label: 'Tạm dừng 1 giờ', click: () => act(() => engine.pause(Date.now(), 60)) },
    { label: 'Tạm dừng (đến khi bật lại)', click: () => act(() => engine.pause(Date.now(), null)) },
    { label: 'Tiếp tục', click: () => act(() => engine.resume(Date.now())) },
    { type: 'separator' },
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
  // Cửa sổ chính thường bị ẩn trong khay, nên tooltip là chỗ duy nhất người dùng
  // còn nhìn thấy khi toast đang bị Windows chặn.
  tray.setToolTip(toastBlocked ? `${text}\n⚠ Windows đang tắt thông báo của StandUp` : text);

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
          // n.show() không báo lỗi khi Windows nuốt toast, nên soát lại công tắc
          // ngay tại đây: cảnh báo phải hiện từ lần nhắc đầu tiên bị mất, chứ
          // không đợi hết chu kỳ soát định kỳ.
          refreshToastBlocked();
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

// ---- Vòng tick & phát trạng thái ----

function idleSecs() {
  return powerMonitor.getSystemIdleTime();
}

function tick() {
  const idle = idleSecs();
  debugLog(`${engine.phase}\tidle=${idle}\tnguong=${engine.idleThresholdSecs()}`);
  applyEffects(engine.tick(Date.now(), idle));
  broadcast();
}

// toastBlocked thuộc về môi trường Windows, không phải trạng thái engine — ghép
// ở đây để engine giữ được tính thuần tuý (và unit-test được). Mọi đường ra
// renderer đều phải qua hàm này, nếu không cảnh báo sẽ nhấp nháy lúc mới mở app.
function statusPayload() {
  return { ...engine.status(Date.now(), idleSecs()), toastBlocked };
}

function broadcast() {
  const st = statusPayload();
  for (const w of [mainWin, reminderWin, onboardWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('status', st);
  }
  updateTray(st);
}

// ---- IPC cho renderer ----

function wireIpc() {
  ipcMain.handle('get-status', () => statusPayload());
  ipcMain.handle('get-settings', () => ({ ...engine.settings }));
  ipcMain.handle('set-settings', (_ev, raw) => {
    // Giữ nguyên cờ onboarded — màn hình cài đặt không được phép bật lại onboarding.
    const s = clampSettings({ ...raw, onboarded: engine.settings.onboarded });
    engine.updateSettings(Date.now(), s);
    saveSettings(s);
    applyAutoStart(s.autoStart);
    broadcast();
    return s;
  });
  // Renderer cần biết đang chạy bản đóng gói hay bản dev để hiển thị đúng ghi chú
  // về mục "khởi động cùng Windows" (bản dev không ghi mục khởi động).
  ipcMain.handle('get-env', () => ({ packaged: app.isPackaged }));
  // App không được tự bật lại công tắc thông báo của Windows — đó là quyết định
  // của người dùng. Chỉ mở đúng trang cài đặt để họ gạt lại cho nhanh.
  ipcMain.handle('open-notification-settings', async () => {
    await shell.openExternal('ms-settings:notifications');
    // Gạt xong quay lại app là thấy cảnh báo biến mất, không phải chờ tới 60s.
    setTimeout(refreshToastBlocked, 3000);
  });
  ipcMain.handle('complete-onboarding', (_ev, raw) => {
    const now = Date.now();
    const s = clampSettings({ ...engine.settings, ...raw, onboarded: true });
    engine.updateSettings(now, s);
    engine.newCycle(now); // đếm lại từ đầu với khoảng vừa chọn
    saveSettings(s);
    applyAutoStart(s.autoStart);
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
    const actions = {
      takeBreak: () => engine.takeBreak(now),
      snooze: () => engine.snooze(now),
      skip: () => engine.skip(now),
      breakNow: () => engine.breakNow(now),
      test: () => engine.triggerReminder(),
      pauseIndef: () => engine.pause(now, null),
      pause1h: () => engine.pause(now, 60),
      resume: () => engine.resume(now),
    };
    if (actions[name]) act(actions[name]);
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
  // Âm báo được tổng hợp bằng Web Audio, không do người dùng bấm nút — Chromium
  // chặn phát tự động nếu thiếu switch này.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  app.on('second-instance', showMain);

  // Hai handler 'close' của cửa sổ chặn việc đóng để app sống tiếp trong tray;
  // cờ isQuitting là lối thoát duy nhất. Trước đây chỉ menu Thoát mới hạ cờ,
  // nên mọi đường thoát khác — Windows logoff, shutdown, app.quit() từ chỗ
  // khác — đều bị app giữ lại cho tới khi hệ điều hành cưỡng bức tắt.
  app.on('before-quit', () => { app.isQuitting = true; });

  app.whenReady().then(() => {
    // Windows cần AppUserModelID để toast hiển thị; khi chưa đóng gói,
    // dùng đường dẫn exe là cách được Electron khuyến nghị cho chế độ dev.
    app.setAppUserModelId(app.isPackaged ? AUMID : process.execPath);
    registerAumid();

    engine = new Engine(loadSettings(), Date.now());
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
    powerMonitor.on('resume', tick);

    // Công tắc thông báo nằm ngoài app, người dùng gạt lúc nào cũng được → soát
    // định kỳ. 60s là đủ nhanh mà không tốn kém (mỗi lần chỉ 1-2 lệnh reg query).
    refreshToastBlocked();
    setInterval(refreshToastBlocked, 60_000);
  });

  // App tray: không thoát khi mọi cửa sổ bị ẩn/đóng.
  app.on('window-all-closed', () => {});
}
