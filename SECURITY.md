# Bảo mật & quyền riêng tư

## Ứng dụng làm gì với dữ liệu của bạn

StandUp **không có mã kết nối mạng**. Không tài khoản, không đồng bộ, không đo đạc từ xa,
không quảng cáo. Toàn bộ dữ liệu nằm trên máy bạn, trong `%APPDATA%\standup`:

| Tệp | Nội dung |
|---|---|
| `settings.json` | Cài đặt của bạn (chu kỳ nhắc, thời gian nghỉ, các công tắc) |
| `standup.log` | Nhật ký sự kiện: khởi động, đổi cài đặt, chuyển trạng thái, ngủ/thức máy, sự cố |

Nhật ký **không** ghi tên cửa sổ, tiêu đề ứng dụng, nội dung gõ phím hay bất cứ thứ gì bạn
đang làm. Gỡ cài đặt không xoá thư mục này — muốn xoá sạch thì xoá tay.

Ứng dụng **có** đọc hai thứ từ hệ điều hành, đều chỉ để quyết định có nên nhắc hay không:

- `powerMonitor.getSystemIdleTime()` — số giây bạn không chạm chuột/bàn phím (không biết bạn gõ gì).
- `SHQueryUserNotificationState` — Windows đang ở chế độ nào (toàn màn hình, trình chiếu, game…),
  gọi qua PowerShell. Trả về một con số 1–7, không kèm thông tin về ứng dụng nào đang chạy.

Ứng dụng ghi một khoá registry `HKCU\Software\Classes\AppUserModelId\vn.standup.app` để
Windows hiện đúng tên/biểu tượng trên toast, và (nếu bạn bật) một khoá trong
`HKCU\...\CurrentVersion\Run` để khởi động cùng Windows. Trình gỡ cài đặt dọn khoá đầu;
tắt công tắc trong Cài đặt thì gỡ khoá thứ hai.

## Báo lỗi bảo mật

Nếu bạn tìm thấy lỗ hổng, xin **đừng mở issue công khai**. Dùng
[GitHub Security Advisory](https://github.com/tarasami/StandUp/security/advisories/new)
để báo riêng, hoặc gửi email tới <thaisami.hust@gmail.com>. Tôi sẽ phản hồi sớm nhất có thể.

Với lỗi thường (không phải bảo mật), mở [issue](https://github.com/tarasami/StandUp/issues) như bình thường.

## Phiên bản được hỗ trợ

Dự án đang ở giai đoạn trước 1.0 chính thức; chỉ nhánh `master` được vá.
