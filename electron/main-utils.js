// Các hàm THUẦN của main process — tách khỏi main.js để unit-test được.
//
// Lý do tồn tại của file này: engine.js được phủ test rất kỹ và chưa từng có lỗi
// nào ở đó, trong khi toàn bộ lỗi thật gặp ngày 10/08/2026 đều nằm trong main.js
// — nơi không có lấy một test, vì file đó require('electron') nên không nạp được
// từ Node thường. Mọi logic không cần Electron nên chuyển sang đây.

const BOM = 0xFEFF;

// Đọc giá trị REG_DWORD từ output của `reg query ... /v <ten>`.
// Trả về số, hoặc null nếu output không chứa giá trị nào (khoá không tồn tại).
// Dạng output thật: "    Enabled    REG_DWORD    0x0"
function parseRegDword(stdout) {
  const m = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout || '');
  return m ? parseInt(m[1], 16) : null;
}

// Parse nội dung settings.json. Trả về object, hoặc null nếu hỏng/không phải object.
function parseSettingsJson(text) {
  try {
    const s = String(text);
    // Cắt BOM (U+FEFF) trước khi parse: file sửa tay bằng trình soạn thảo Windows
    // rất dễ dính BOM ở đầu, mà JSON.parse thì ném lỗi vì nó — hậu quả là mất
    // sạch cài đặt và bị bắt onboarding lại, không một lời báo. So mã ký tự chứ
    // không dùng regex, để trong mã nguồn không có ký tự vô hình nào.
    const body = s.charCodeAt(0) === BOM ? s.slice(1) : s;
    const parsed = JSON.parse(body);
    // Mảng và null cũng lọt qua JSON.parse nhưng không dùng làm cài đặt được.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Chiều cao cửa sổ chính theo hai trạng thái độc lập: cài đặt đang MỞ hay đóng
// (bấm nút ⚙ để xổ ra), và có dải cảnh báo "Windows chặn thông báo" hay không.
// Bốn chiều cao (h.compact / h.compactWarn / h.full / h.fullWarn) đo thật bằng
// DevTools. Kẹp về vùng làm việc để cửa sổ không thò xuống dưới taskbar; vượt
// thì để nội dung tự cuộn còn hơn mất nút.
function mainWindowHeight(settingsOpen, blocked, maxHeight, h) {
  const want = settingsOpen
    ? (blocked ? h.fullWarn : h.full)
    : (blocked ? h.compactWarn : h.compact);
  return Math.min(want, maxHeight);
}

// Khoảng cách từ mép màn hình khi đặt cửa sổ nhắc ở góc.
const REMINDER_MARGIN = 16;

// Toạ độ góc trên-trái để đặt cửa sổ nhắc, theo lựa chọn vị trí.
//   wa  = workArea {x, y, width, height} — đã trừ taskbar.
//   win = {width, height} của cửa sổ nhắc.
// Trả về {x, y} nguyên. Chỉ 'center' là trường hợp riêng; mọi giá trị khác
// (kể cả rác) đều rơi về góc dưới-phải — clampSettings đã lọc trước rồi nên
// đây chỉ là lưới an toàn cuối.
function reminderXY(pos, wa, win) {
  if (pos === 'center') {
    return {
      x: Math.round(wa.x + (wa.width - win.width) / 2),
      y: Math.round(wa.y + (wa.height - win.height) / 2),
    };
  }
  return {
    x: wa.x + wa.width - win.width - REMINDER_MARGIN,
    y: wa.y + wa.height - win.height - REMINDER_MARGIN,
  };
}

module.exports = {
  parseRegDword, parseSettingsJson, mainWindowHeight, reminderXY, REMINDER_MARGIN,
};
