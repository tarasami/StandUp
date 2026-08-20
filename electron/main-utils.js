// Các hàm THUẦN của main process — tách khỏi main.js để unit-test được.
//
// Lý do tồn tại của file này: engine.js được phủ test rất kỹ và chưa từng có lỗi
// nào ở đó, trong khi toàn bộ lỗi thật gặp ngày 10/08/2026 đều nằm trong main.js
// — nơi không có lấy một test, vì file đó require('electron') nên không nạp được
// từ Node thường. Mọi logic không cần Electron nên chuyển sang đây.

const BOM = 0xFEFF;

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

// Chiều cao cửa sổ chính theo việc cài đặt đang MỞ (bấm nút ⚙ để xổ ra) hay đóng.
// Hai chiều cao (h.compact / h.full) đo thật bằng DevTools. Kẹp về vùng làm việc
// để cửa sổ không thò xuống dưới taskbar; vượt thì để nội dung tự cuộn còn hơn
// mất nút.
function mainWindowHeight(settingsOpen, maxHeight, h) {
  return Math.min(settingsOpen ? h.full : h.compact, maxHeight);
}

// Giữ cửa sổ nằm trọn trong vùng làm việc sau khi đổi chiều cao.
//   y      = mép trên hiện tại, height = chiều cao MỚI, wa = workArea {y, height}.
// Cửa sổ chính cao thêm 480px khi xổ cài đặt. Nếu chỉ đổi chiều cao thì phần thêm
// mọc XUỐNG DƯỚI: cửa sổ đang ở giữa màn hình 1080 (y=328) sẽ có đáy ở 1153 trong
// khi vùng làm việc chỉ tới 1040 — nút "Lưu cài đặt" rơi ra ngoài màn hình, người
// dùng thấy cài đặt bị cắt cụt và không lưu được.
// Đẩy lên VỪA ĐỦ, không hơn: người dùng kê cửa sổ ở đâu thì tôn trọng chỗ đó.
// Kẹp cả mép trên, phòng khi cửa sổ cao hơn cả vùng làm việc (màn hình rất thấp) —
// lúc đó thà lòi đáy để nội dung tự cuộn, còn hơn mất luôn thanh tiêu đề.
function clampWindowY(y, height, wa) {
  return Math.round(Math.max(wa.y, Math.min(y, wa.y + wa.height - height)));
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

// Định dạng một dòng nhật ký: thời gian ĐỊA PHƯƠNG (dễ đọc khi soi lỗi) + cấp +
// thông điệp. Nhận sẵn một Date nên hàm thuần, test được. Ký tự xuống dòng trong
// thông điệp bị đổi thành khoảng trắng để mỗi sự kiện luôn gọn đúng một dòng.
function formatLogLine(date, level, message) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} `
    + `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`;
  const msg = String(message).replace(/[\r\n]+/g, ' ');
  return `${ts}  ${String(level).toUpperCase().padEnd(5)}  ${msg}`;
}

// Đã đến lúc xoay vòng file nhật ký chưa: kích thước hiện tại chạm/vượt ngưỡng.
function shouldRotateLog(currentBytes, maxBytes) {
  return Number(currentBytes) >= Number(maxBytes);
}

// Diễn giải kết quả SHQueryUserNotificationState (số 1..7 của Windows) thành "có
// được phép bung cửa sổ nhắc lúc này không". CHỈ 5 (QUNS_ACCEPTS_NOTIFICATIONS)
// là desktop bình thường → được phép. Mọi giá trị khác đều là lúc KHÔNG nên làm
// phiền: 1 khoá máy/screensaver, 2 app full-screen (video, trình chiếu đang
// xem), 3 game D3D full-screen, 4 chế độ trình chiếu, 6 quiet-time, 7 app full-
// screen kiểu Store. Đọc KHÔNG ra số hợp lệ (truy vấn lỗi trả -1, chuỗi rỗng,
// rác) → coi như ĐƯỢC PHÉP (fail-open): thà lỡ nhắc lúc full-screen còn hơn tự
// tắt hẳn tính năng nhắc chỉ vì một lần hỏi Windows bị hỏng.
const QUNS_ACCEPTS_NOTIFICATIONS = 5;
function notificationsAllowedFromState(raw) {
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 7) return true; // không rõ → cho phép
  return n === QUNS_ACCEPTS_NOTIFICATIONS;
}

module.exports = {
  parseSettingsJson, mainWindowHeight, clampWindowY, reminderXY, REMINDER_MARGIN,
  formatLogLine, shouldRotateLog, notificationsAllowedFromState,
};
