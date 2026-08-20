// Unit test cho các hàm thuần của main process — chạy: npm test
// Toàn bộ lỗi thật gặp ngày 10/08/2026 đều nằm ở tầng Electron chứ không phải
// engine. Những gì tách ra được khỏi tầng đó thì phải có test, bắt đầu từ đây.
const assert = require('node:assert');
const {
  parseSettingsJson, mainWindowHeight, clampWindowY, reminderXY, REMINDER_MARGIN,
  formatLogLine, shouldRotateLog, notificationsAllowedFromState,
} = require('../electron/main-utils');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('1. parseSettingsJson — chống file settings hỏng');
const GOOD = '{ "intervalMins": 45, "breakMins": 5 }';
// Dùng dạng mã số, không viết ký tự vô hình thẳng vào mã nguồn.
const BOM = String.fromCharCode(0xFEFF);
check('JSON hợp lệ parse được', parseSettingsJson(GOOD).intervalMins === 45);
// Hồi quy: file dính BOM từng làm mất sạch cài đặt và bắt onboarding lại.
check('file dính BOM ở đầu vẫn parse được', parseSettingsJson(`${BOM}${GOOD}`).intervalMins === 45);
check('BOM + xuống dòng vẫn parse được', parseSettingsJson(`${BOM}\n${GOOD}`).breakMins === 5);
check('JSON cụt giữa chừng → null', parseSettingsJson('{ "intervalMins": 4') === null);
check('file rỗng → null', parseSettingsJson('') === null);
check('rác hoàn toàn → null', parseSettingsJson('khong phai json') === null);
// Ba thứ dưới đây đều là JSON hợp lệ nhưng không dùng làm cài đặt được.
check('null → null', parseSettingsJson('null') === null);
check('mảng → null', parseSettingsJson('[1,2,3]') === null);
check('số trần → null', parseSettingsJson('42') === null);
check('không ném lỗi với undefined', parseSettingsJson(undefined) === null);

console.log('2. mainWindowHeight — chiều cao theo đóng/mở cài đặt');
// Giá trị đại diện; test chỉ kiểm hàm CHỌN đúng ô, không phải số đo thật.
const H = { compact: 384, full: 750 };
check('đóng cài đặt → compact', mainWindowHeight(false, 1080, H) === 384);
check('MỞ cài đặt → full', mainWindowHeight(true, 1080, H) === 750);
// Kẹp về vùng làm việc: màn hình thấp không chứa nổi chiều cao mong muốn.
check('màn hình thấp → kẹp full về workArea', mainWindowHeight(true, 700, H) === 700);
check('màn hình rất thấp → kẹp cả compact', mainWindowHeight(false, 300, H) === 300);

console.log('2b. clampWindowY — giãn cửa sổ mà không thò khỏi màn hình');
// Màn hình 1920×1080, taskbar dưới → workArea cao 1040, gốc (0,0).
const WORK = { x: 0, y: 0, width: 1920, height: 1040 };
check('đang vừa màn hình → giữ nguyên chỗ', clampWindowY(300, 384, WORK) === 300);
// Hồi quy đúng ca người dùng báo: cửa sổ ở giữa (y=328) xổ cài đặt cao 864 thì
// đáy tới 1192 — phải đẩy lên 176 để nút Lưu không rơi ra ngoài màn hình.
check('giãn ra quá đáy → đẩy lên vừa đủ', clampWindowY(328, 864, WORK) === 176);
check('đẩy lên xong thì đáy chạm mép vùng làm việc', clampWindowY(328, 864, WORK) + 864 === 1040);
check('sát mép dưới sẵn → vẫn kẹp về trong', clampWindowY(1000, 384, WORK) === 656);
check('thu nhỏ lại thì không tự dịch', clampWindowY(176, 384, WORK) === 176);
// Cửa sổ cao hơn cả vùng làm việc: giữ mép trên, thà lòi đáy còn hơn mất tiêu đề.
check('cao hơn màn hình → dán mép trên', clampWindowY(300, 1200, WORK) === 0);
// Màn hình phụ đặt bên trên/dưới, hoặc taskbar nằm ngang trên cùng → wa.y khác 0.
const WORK_TOP = { x: 0, y: -1080, width: 1920, height: 1050 };
check('màn hình phụ ở trên (y âm) → kẹp theo wa.y', clampWindowY(-1500, 384, WORK_TOP) === -1080);
check('màn hình phụ ở trên → kẹp theo đáy của nó', clampWindowY(-200, 864, WORK_TOP) === -894);

console.log('3. reminderXY — đặt cửa sổ nhắc theo vị trí đã chọn');
const WIN = { width: 380, height: 250 };
// Màn hình 1920×1080, taskbar dưới → workArea cao 1040, gốc (0,0).
const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const br = reminderXY('bottom-right', WA, WIN);
check('dưới-phải: cách mép phải đúng 16px',
  br.x === 1920 - 380 - REMINDER_MARGIN && br.x === 1524);
check('dưới-phải: cách mép dưới đúng 16px',
  br.y === 1040 - 250 - REMINDER_MARGIN && br.y === 774);
// Khớp phép đo thật trên bản đã cài: getBounds là toạ độ logic, GetWindowRect
// đo được (1516,774) — lệch 8px ở x là do viền vô hình DWM, y trùng khít.
const ce = reminderXY('center', WA, WIN);
check('giữa: căn giữa ngang', ce.x === Math.round((1920 - 380) / 2) && ce.x === 770);
check('giữa: căn giữa dọc', ce.y === Math.round((1040 - 250) / 2) && ce.y === 395);
// workArea có gốc lệch: màn hình phụ bên phải (x=1920) hoặc taskbar ở trên (y=48).
const right = reminderXY('bottom-right', { x: 1920, y: 0, width: 1920, height: 1040 }, WIN);
check('màn hình phụ bên phải: toạ độ cộng thêm gốc x', right.x === 1920 + 1920 - 380 - REMINDER_MARGIN);
const topbar = reminderXY('bottom-right', { x: 0, y: 48, width: 1920, height: 1032 }, WIN);
check('taskbar ở trên: y tính theo gốc workArea', topbar.y === 48 + 1032 - 250 - REMINDER_MARGIN);
const ctop = reminderXY('center', { x: 0, y: 48, width: 1920, height: 1032 }, WIN);
check('giữa trên workArea lệch gốc: cộng đúng gốc y', ctop.y === Math.round(48 + (1032 - 250) / 2));
// Kích thước lẻ → làm tròn, không để toạ độ thập phân (setPosition cần số nguyên).
const odd = reminderXY('center', { x: 0, y: 0, width: 1001, height: 1001 }, WIN);
check('kích thước lẻ: toạ độ giữa được làm tròn thành số nguyên',
  Number.isInteger(odd.x) && Number.isInteger(odd.y) && odd.x === 311);
// Lưới an toàn: giá trị lạ lọt tới đây (đáng lẽ clampSettings đã chặn) → dưới-phải.
check('vị trí lạ → rơi về dưới-phải', reminderXY('gibberish', WA, WIN).x === br.x);
check('vị trí undefined → rơi về dưới-phải', reminderXY(undefined, WA, WIN).y === br.y);

console.log('4. formatLogLine / shouldRotateLog — nhật ký sự kiện');
// Tháng trong Date là 0-based: 7 = tháng 8.
const D = new Date(2026, 7, 17, 9, 5, 3, 42);
check('định dạng đủ ngày-giờ-mili giây + cấp',
  formatLogLine(D, 'info', 'khởi động') === '2026-08-17 09:05:03.042  INFO   khởi động');
check('cấp ERROR canh lề đúng', formatLogLine(D, 'error', 'x') === '2026-08-17 09:05:03.042  ERROR  x');
check('cấp được viết hoa', formatLogLine(D, 'warn', 'x').includes('WARN'));
// Số 1 chữ số phải đệm 0 (tháng/ngày/giờ/mili giây).
check('đệm 0 cho số 1 chữ số',
  formatLogLine(new Date(2026, 0, 2, 3, 4, 5, 6), 'info', 'x').startsWith('2026-01-02 03:04:05.006'));
// Sự kiện phải luôn gọn 1 dòng, kể cả thông điệp nhiều dòng (ví dụ stack lỗi).
check('xuống dòng trong thông điệp bị gộp thành 1 dòng',
  formatLogLine(D, 'error', 'lỗi\ndòng2\r\ndòng3').split('\n').length === 1);
check('thông điệp không phải chuỗi cũng không ném lỗi',
  typeof formatLogLine(D, 'info', 42) === 'string');
check('xoay vòng: dưới ngưỡng → không', shouldRotateLog(999999, 1000000) === false);
check('xoay vòng: đúng ngưỡng → có', shouldRotateLog(1000000, 1000000) === true);
check('xoay vòng: vượt ngưỡng → có', shouldRotateLog(5000000, 1000000) === true);

console.log('5. notificationsAllowedFromState — chỉ nhắc khi Windows cho phép');
const A = notificationsAllowedFromState;
// 5 = QUNS_ACCEPTS_NOTIFICATIONS: desktop bình thường → được nhắc.
check('trạng thái 5 (bình thường) → được phép', A('5') === true);
check('có xuống dòng vẫn đọc đúng', A('5\r\n') === true);
check('có khoảng trắng thừa vẫn đọc đúng', A('  5  ') === true);
// Mọi trạng thái "đang bận" → KHÔNG nhắc (khoan bung tới khi rảnh).
check('1 (khoá máy/screensaver) → hoãn', A('1') === false);
check('2 (app full-screen: video/trình chiếu) → hoãn', A('2') === false);
check('3 (game D3D full-screen) → hoãn', A('3') === false);
check('4 (chế độ trình chiếu) → hoãn', A('4') === false);
check('6 (quiet-time) → hoãn', A('6') === false);
check('7 (app Store full-screen) → hoãn', A('7') === false);
// Fail-open: hỏi hỏng thì THÀ nhắc còn hơn tắt hẳn tính năng.
check('-1 (truy vấn lỗi) → fail-open, vẫn nhắc', A('-1') === true);
check('chuỗi rỗng → fail-open', A('') === true);
check('rác không phải số → fail-open', A('abc') === true);
check('số ngoài dải 1..7 (99) → fail-open', A('99') === true);
check('0 (ngoài dải) → fail-open', A('0') === true);
check('undefined → fail-open', A(undefined) === true);

console.log(`\nTẤT CẢ ${passed} KIỂM TRA ĐỀU ĐẠT ✅`);
