// Unit test cho các hàm thuần của main process — chạy: npm test
// Toàn bộ lỗi thật gặp ngày 10/08/2026 đều nằm ở tầng Electron chứ không phải
// engine. Những gì tách ra được khỏi tầng đó thì phải có test, bắt đầu từ đây.
const assert = require('node:assert');
const { parseRegDword, parseSettingsJson, mainWindowHeight } = require('../electron/main-utils');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('1. parseRegDword — đọc output thật của reg query');
// Output y hệt reg.exe trả về, giữ nguyên \r\n và khoảng trắng.
const REAL_OFF = '\r\nHKEY_CURRENT_USER\\...\\vn.standup.app\r\n    Enabled    REG_DWORD    0x0\r\n\r\n';
const REAL_ON = '\r\nHKEY_CURRENT_USER\\...\\vn.standup.app\r\n    Enabled    REG_DWORD    0x1\r\n\r\n';
check('Enabled = 0x0 → 0 (thông báo đang TẮT)', parseRegDword(REAL_OFF) === 0);
check('Enabled = 0x1 → 1 (đang BẬT)', parseRegDword(REAL_ON) === 1);
check('giá trị hex nhiều chữ số đọc đúng', parseRegDword('  X    REG_DWORD    0x1f\r\n') === 31);
check('chữ hex viết hoa vẫn đọc được', parseRegDword('  X    REG_DWORD    0xFF\r\n') === 255);
// Khoá không tồn tại: reg.exe in ra stdout rỗng và báo lỗi ở stderr.
check('không có giá trị nào → null, KHÔNG phải 0', parseRegDword('\r\n\r\n') === null);
check('chuỗi rỗng → null', parseRegDword('') === null);
check('undefined → null (không được ném lỗi)', parseRegDword(undefined) === null);
// Đây là điểm chết người: nhầm "không tìm thấy" thành 0 sẽ khiến app báo bị
// chặn trong khi thật ra Windows vẫn cho thông báo bình thường.
check('null KHÁC 0 — không được lẫn "thiếu khoá" với "đang tắt"', parseRegDword('') !== 0);
check('bỏ qua REG_QWORD, chỉ nhận REG_DWORD',
  parseRegDword('  LastNotificationAddedTime    REG_QWORD    0x1dd2658936bb9c2\r\n') === null);

console.log('2. parseSettingsJson — chống file settings hỏng');
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

console.log('3. mainWindowHeight — nới cửa sổ khi có dải cảnh báo');
check('không bị chặn → chiều cao thường', mainWindowHeight(null, 1080, 710, 812) === 710);
check('bị chặn → nới ra cho vừa dải cảnh báo', mainWindowHeight('app', 1080, 710, 812) === 812);
check('lý do "system" cũng nới', mainWindowHeight('system', 1080, 710, 812) === 812);
// Màn hình 768px (workArea ~728): 812px sẽ thò xuống dưới taskbar.
check('màn hình thấp → kẹp về vùng làm việc', mainWindowHeight('app', 728, 710, 812) === 728);
check('màn hình rất thấp → kẹp cả chiều cao thường',
  mainWindowHeight(null, 600, 710, 812) === 600);

console.log(`\nTẤT CẢ ${passed} KIỂM TRA ĐỀU ĐẠT ✅`);
