# Nhật ký thay đổi

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).
Dự án chưa phát hành bản chính thức nào — xem [phần Còn thiếu gì trong README](README.md#còn-thiếu-gì).

---

## [Chưa phát hành]

Toàn bộ phần gia cố sau khi hoàn thành MVP, đều đã kiểm chứng trên app chạy thật và trên
bản đã cài.

### Thêm

- **Màn nghỉ che màn hình kèm hình giãn cơ** (`e889697`) — mỗi giờ nghỉ hiện một trong 8
  động tác (xoay vai, duỗi cổ, vươn người, gập lưng, giãn cổ tay, nghỉ mắt, đi vài bước,
  nhón chân) kèm hình động vẽ bằng SVG/CSS, không tệp ảnh/video. Có công tắc bật/tắt, thoát
  bằng `Esc`. Tôn trọng `prefers-reduced-motion`.
- **Nhường toàn màn hình** (`35822cd`, `573b6f4`) — hoãn lời nhắc khi đang xem phim, chơi
  game full-screen hoặc trình chiếu, hỏi Windows qua `SHQueryUserNotificationState`. Có
  công tắc bật/tắt, hành xử *fail-open*.
- **Tự hoãn lời nhắc bị phớt lờ** (`4666dbd`) — cửa sổ nhắc để quá 3 phút sẽ tự đóng và hoãn
  5 phút, thay vì treo trên màn hình rồi im luôn.
- **Nhật ký sự kiện luôn bật** (`7789704`) tại `%APPDATA%\standup\standup.log`, tự xoay vòng
  ~1MB, cộng với **bắt mọi sự cố ngoài dự tính vào nhật ký** (`4666dbd`) thay cho hộp thoại
  lỗi phá ngang app nền.
- **Chọn vị trí cửa sổ nhắc** (`46d96c0`) — dưới-phải (mặc định) hoặc giữa màn hình.

### Thay đổi

- **Lời nhắc bỏ hẳn toast Windows** (`7bf3bc6`) — cửa sổ nhắc nổi là kênh duy nhất lúc tới
  giờ. Toast dễ bị hệ thống nuốt ngầm, mà đây là chức năng cốt lõi. Toast chỉ còn dùng lúc
  hết giờ nghỉ và xong onboarding.
- **Thu gọn cửa sổ chính** (`6007b07`) — phần cài đặt ẩn sau nút ⚙, bấm để xổ ra.
- **Chỉnh hình giãn cơ cho khớp lời mô tả** (`833a9e5`, `f07e300`) — xoay vai đảo đúng
  chiều; vươn người dùng cặp tay dài riêng để tay thật sự vượt đỉnh đầu; gập lưng vẽ lại ở
  góc **nhìn nghiêng** vì nhìn thẳng không đọc ra động tác.

### Sửa

- **Cửa sổ Cài đặt tràn khỏi màn hình, nuốt mất nút Lưu** (`d8f702a`) — cửa sổ giãn từ 384
  lên 864px chỉ đổi chiều cao nên mọc xuống dưới; nằm giữa màn hình 1080 thì đáy tới 1192
  trong khi vùng làm việc chỉ tới 1040, nút *Lưu cài đặt* rơi ra ngoài. Thêm `clampWindowY()`
  và đổi `setSize` → `setBounds` để dịch cả vị trí.
- **Giảm chuyển động không chặn hết** (`5f1a0a8`) — `prefers-reduced-motion` chỉ liệt kê
  phần tử con nên animation căn khung nằm trên chính phần tử gốc vẫn chạy, làm hình gập lưng
  trượt ngang 18px.
- **Cửa sổ nhắc bị che** (`e9b7511`) — thêm `moveTop()` để nổi lên đỉnh nhóm always-on-top.
- Bốn lỗi cấu hình và đa màn hình (`3bf2275`), kèm bổ sung test cho tầng Electron.

### Gỡ bỏ

- **Hệ thống cảnh báo "Windows chặn thông báo"** (`2c2a88e`) — hết tác dụng sau khi lời nhắc
  không còn phụ thuộc toast.

---

## [1.0.0] — 2026-08-11

Nền tảng đầu tiên: đủ 8/8 hạng mục MVP, đã kiểm chứng trên bản cài đặt thật (`d865496`).

### Thêm

- Bộ đếm chu kỳ ngồi cấu hình được (mặc định 45 phút), đếm bằng **timestamp tuyệt đối** nên
  sống sót qua sleep/hibernate.
- Cửa sổ nhắc nổi với ba lựa chọn: **Nghỉ ngay** / **Hoãn 5'** / **Bỏ qua**.
- Chế độ nghỉ có đếm ngược, hết giờ tự bắt đầu chu kỳ mới.
- **Idle detection** — rời máy quá N phút thì coi như đã nghỉ, quay lại là chu kỳ mới.
- Tray icon hiện số phút còn lại ngay trên biểu tượng, đổi màu theo trạng thái; menu đầy đủ.
- Cài đặt lưu tại `%APPDATA%\standup\settings.json`, có `clampSettings` chống dữ liệu rác.
- **Onboarding một màn hình** cho lần chạy đầu.
- **Khởi động cùng Windows**, chạy ẩn bằng cờ `--hidden`.
- 12 câu nhắc xoay vòng và 4 câu báo hết giờ nghỉ, không lặp trước khi dùng hết bộ.
- Âm báo tổng hợp bằng Web Audio (hai nốt sine), tắt được.
- **Installer NSIS** cho phép chọn thư mục cài, tạo shortcut Desktop + Start Menu, gỡ cài
  đặt không xoá cài đặt cá nhân.
- Tự đăng ký AUMID qua registry để toast hiện đúng tên và biểu tượng.
