// Unit test cho các hàm thuần của main process — chạy: npm test
// Toàn bộ lỗi thật gặp ngày 10/08/2026 đều nằm ở tầng Electron chứ không phải
// engine. Những gì tách ra được khỏi tầng đó thì phải có test, bắt đầu từ đây.
const assert = require('node:assert');
const {
  parseSettingsJson, mainWindowHeight, reminderXY, REMINDER_MARGIN,
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

console.log(`\nTẤT CẢ ${passed} KIỂM TRA ĐỀU ĐẠT ✅`);
