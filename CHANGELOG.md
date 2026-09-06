# Nhật ký thay đổi

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).
Dự án chưa phát hành bản chính thức nào — xem [lộ trình trong README](README.md#lộ-trình).

---

## [Chưa phát hành]

Toàn bộ phần gia cố sau khi hoàn thành MVP, đều đã kiểm chứng trên app chạy thật và trên
bản đã cài.

### Thêm

- **Màn nghỉ che màn hình kèm hình giãn cơ** (`b759cfc`) — mỗi giờ nghỉ hiện một trong 8
  động tác (xoay vai, duỗi cổ, vươn người, gập lưng, giãn cổ tay, nghỉ mắt, đi vài bước,
  nhón chân) kèm hình động vẽ bằng SVG/CSS, không tệp ảnh/video. Có công tắc bật/tắt, thoát
  bằng `Esc`. Tôn trọng `prefers-reduced-motion`.
- **Nhường toàn màn hình** (`56b263b`, `19e839b`) — hoãn lời nhắc khi đang xem phim, chơi
  game full-screen hoặc trình chiếu, hỏi Windows qua `SHQueryUserNotificationState`. Có
  công tắc bật/tắt, hành xử *fail-open*.
- **Tự hoãn lời nhắc bị phớt lờ** (`99c37c9`) — cửa sổ nhắc để quá 3 phút sẽ tự đóng và hoãn
  5 phút, thay vì treo trên màn hình rồi im luôn.
- **Nhật ký sự kiện luôn bật** (`7e05eed`) tại `%APPDATA%\standup\standup.log`, tự xoay vòng
  ~1MB, cộng với **bắt mọi sự cố ngoài dự tính vào nhật ký** (`99c37c9`) thay cho hộp thoại
  lỗi phá ngang app nền.
- **Chọn vị trí cửa sổ nhắc** (`7edf987`) — dưới-phải (mặc định) hoặc giữa màn hình.

### Thay đổi

- **Lời nhắc bỏ hẳn toast Windows** (`ad154af`) — cửa sổ nhắc nổi là kênh duy nhất lúc tới
  giờ. Toast dễ bị hệ thống nuốt ngầm, mà đây là chức năng cốt lõi. Toast chỉ còn dùng lúc
  hết giờ nghỉ và xong onboarding.
- **Thu gọn cửa sổ chính** (`13a14fa`) — phần cài đặt ẩn sau nút ⚙, bấm để xổ ra.
- **Chỉnh hình giãn cơ cho khớp lời mô tả** (`f5d1cc5`, `ac5ac8b`) — xoay vai đảo đúng
  chiều; vươn người dùng cặp tay dài riêng để tay thật sự vượt đỉnh đầu; gập lưng vẽ lại ở
  góc **nhìn nghiêng** vì nhìn thẳng không đọc ra động tác.

### Sửa

- **Cửa sổ Cài đặt tràn khỏi màn hình, nuốt mất nút Lưu** (`5ca04c2`) — cửa sổ giãn từ 384
  lên 864px chỉ đổi chiều cao nên mọc xuống dưới; nằm giữa màn hình 1080 thì đáy tới 1192
  trong khi vùng làm việc chỉ tới 1040, nút *Lưu cài đặt* rơi ra ngoài. Thêm `clampWindowY()`
  và đổi `setSize` → `setBounds` để dịch cả vị trí.
- **Giảm chuyển động không chặn hết** (`b9419fc`) — `prefers-reduced-motion` chỉ liệt kê
  phần tử con nên animation căn khung nằm trên chính phần tử gốc vẫn chạy, làm hình gập lưng
  trượt ngang 18px.
- **Cửa sổ nhắc bị che** (`1938fb5`) — thêm `moveTop()` để nổi lên đỉnh nhóm always-on-top.
- Bốn lỗi cấu hình và đa màn hình (`93d874a`), kèm bổ sung test cho tầng Electron.

### Gỡ bỏ

- **Hệ thống cảnh báo "Windows chặn thông báo"** (`9766ed9`) — hết tác dụng sau khi lời nhắc
  không còn phụ thuộc toast.

---

## [1.0.0] — 2026-08-11

Nền tảng đầu tiên: đủ 8/8 hạng mục MVP, đã kiểm chứng trên bản cài đặt thật (`22e1274`).

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
