# 🧍 StandUp

Ứng dụng desktop nhắc nhở vận động cho người làm việc máy tính: phát thông báo nhắc đứng dậy đi lại/giãn cơ sau mỗi khoảng thời gian ngồi làm việc do bạn cài đặt.

Xem [PLAN.md](PLAN.md) để biết kế hoạch sản phẩm đầy đủ.

## Chạy ứng dụng

Yêu cầu: Node.js ≥ 20.

```bash
npm install
npm start
```

Chạy unit test cho engine (không cần cài Electron):

```bash
npm test
```

## Đóng gói bản cài đặt

```bash
npm run dist
```

Tạo `dist/StandUp-Setup-1.0.0.exe` (NSIS, x64). Người dùng chọn được thư mục cài, có shortcut Desktop + Start Menu. Gỡ cài đặt **không** xoá cài đặt cá nhân trong `%APPDATA%/standup`.

Vẽ lại bộ icon (7 kích thước 16→256px) khi đổi thiết kế:

```bash
npm run icon
```

## Tính năng (MVP 1.0)

- ⏱ Chu kỳ nhắc cấu hình được (mặc định 45 phút) — đếm bằng **timestamp tuyệt đối**, sống sót qua sleep/hibernate.
- 🔔 Khi tới giờ: notification hệ thống + cửa sổ nhắc nổi góc màn hình (không cướp focus) với 3 nút **Nghỉ ngay / Hoãn 5' / Bỏ qua**.
- 🧘 Chế độ nghỉ có đếm ngược; hết giờ nghỉ tự bắt đầu chu kỳ mới.
- 👣 **Idle detection**: rời máy quá N phút (mặc định 5') → tự coi là đã nghỉ, quay lại máy là chu kỳ mới tự chạy. Đứng dậy bỏ đi ngay sau khi được nhắc cũng được tự ghi nhận — không cần bấm gì.
- 📌 Tray icon **hiện số phút còn lại ngay trên icon** (đổi màu theo trạng thái: xanh = đang làm việc, vàng = nhắc/nghỉ, xám = rời máy/tạm dừng); tooltip chi tiết; menu Nghỉ ngay / Thử nhắc nhở / Tạm dừng 1 giờ / Tạm dừng vô thời hạn / Tiếp tục / Thoát.
- 🎉 **Onboarding 1 màn hình** cho lần chạy đầu: chọn khoảng nhắc (preset 30/45/60 hoặc tự nhập, đồng bộ hai chiều), bật/tắt khởi động cùng Windows và âm báo, kèm hướng dẫn ghim icon tray. Bấm **Bắt đầu** là app thu vào khay và đếm luôn.
- 🚀 **Khởi động cùng Windows** (`app.setLoginItemSettings`), chạy ẩn bằng cờ `--hidden` để không bung cửa sổ lúc đăng nhập.
- 💬 **12 câu nhắc xoay vòng** (và 4 câu báo hết giờ nghỉ) — không lặp lại trước khi dùng hết bộ, tránh nhàm. Cửa sổ nhắc và thông báo hệ thống luôn dùng cùng một câu.
- 🔔 **Âm báo nhẹ** tổng hợp bằng Web Audio (2 nốt sine, không cần file nhạc): đi lên khi nhắc, đi xuống khi hết giờ nghỉ. Tắt được trong cài đặt.
- ⚙️ Cài đặt lưu tại `%APPDATA%/standup/settings.json`.
- Đóng cửa sổ chính = thu về tray, app vẫn chạy nền. Thoát hẳn qua menu tray.

## Cấu trúc mã

```
electron/
  engine.js      # State machine thuần + bộ câu nhắc + clampSettings — unit-test được
  main.js        # Main process: tray, cửa sổ, notification, powerMonitor, vòng tick 1s
  preload.js     # contextBridge — cầu IPC an toàn cho renderer
src/
  index.html     # Cửa sổ chính: trạng thái + cài đặt
  onboarding.html# Màn hình lần chạy đầu
  reminder.html  # Cửa sổ nhắc nổi (frameless, always-on-top)
tools/
  make-icon.js   # Sinh icon.ico 7 kích thước, không cần thư viện ngoài
test/
  engine.test.js # 110 kiểm tra
```

Nguyên tắc kiến trúc: **toàn bộ logic nghiệp vụ nằm trong `engine.js`** — một state machine thuần không phụ thuộc Electron, nhận `(now, idleSecs)` và trả về danh sách effect. Tầng Electron chỉ thực thi effect (mở/đóng cửa sổ, bắn notification). Nhờ vậy logic test được bằng mô phỏng thời gian, và khi chuyển shell (Electron → Tauri) chỉ cần port phần vỏ.

## Ghi chú kỹ thuật

- **Vì sao Electron (tạm thời)?** Kế hoạch đề xuất Tauri 2, nhưng máy dev hiện chưa có Rust + MSVC Build Tools (~3–4GB). Electron chạy được ngay với Node có sẵn; toàn bộ UI (HTML/CSS/JS) và engine sẽ tái sử dụng khi chuyển sang Tauri ở giai đoạn 1.0. Cài toolchain Tauri khi sẵn sàng:
  ```
  winget install Rustlang.Rustup
  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  ```
- Idle detection dùng `powerMonitor.getSystemIdleTime()` (tương đương `GetLastInputInfo` Win32) — đã kiểm chứng end-to-end với input thật của Windows. Lưu ý khi tự test: `SetCursorPos` không được Windows tính là input; phải dùng `mouse_event`/`SendInput`.
- Chẩn đoán app chạy nền: đặt `STANDUP_DEBUG=<đường dẫn file>` trước khi chạy để ghi nhật ký mỗi tick (`thời gian, trạng thái, idle, ngưỡng`).
- **Windows 10 mặc định giấu icon tray mới** trong vùng tràn (sau nút `^`). Với app chỉ sống ở tray đây là rủi ro "app vô hình" — onboarding đã có phần hướng dẫn kéo icon ra taskbar.
- **Khởi động cùng Windows chỉ áp dụng ở bản đóng gói.** Bản dev sẽ trỏ mục khởi động vào `electron.exe` trong `node_modules`; xoá thư mục đó là để lại mục khởi động chết trong registry. Vì vậy `applyAutoStart()` tự bỏ qua khi `!app.isPackaged`, và UI hiện ghi chú tương ứng.
- Âm báo dùng `AudioContext`. Hai điểm dễ sai: phải `await ctx.resume()` **trước khi** lên lịch nốt (lên lịch lúc context còn ngủ thì không nốt nào kêu), và cần switch `autoplay-policy=no-user-gesture-required` vì âm phát không do người dùng bấm.
- "Tạm dừng đến hết ngày" trong kế hoạch tạm được thay bằng "Tạm dừng vô thời hạn" — tính ngày/giờ địa phương sẽ bổ sung cùng tính năng Lịch làm việc (v1.1).
- Bản đóng gói và bản dev **dùng chung** `%APPDATA%/standup` (Windows không phân biệt hoa thường giữa `standup` và `StandUp`), nên cài đặt chuyển qua lại giữa hai bản.
- **Toast banner cần đăng ký AUMID qua registry.** Shortcut Start Menu mang AppUserModelID (cơ chế electron-builder tạo sẵn) là KHÔNG đủ trên mọi máy: đã gặp trường hợp toast vào Action Center nhưng banner không bật. App tự ghi khoá `HKCU\Software\Classes\AppUserModelId\vn.standup.app` (DisplayName kiểu REG_EXPAND_SZ + IconUri) mỗi lần khởi động bản đóng gói (`registerAumid()` trong main.js); uninstaller dọn khoá này (`build/installer.nsh`). Chẩn đoán toast khi cần: `SHQueryUserNotificationState` cho trạng thái hệ thống, `ToastNotificationManager::History.GetHistory(aumid)` chứng minh việc giao nhận không phụ thuộc banner có hiện hay không.

## Trạng thái

Đủ **8/8 hạng mục MVP** trong [PLAN.md](PLAN.md) — Sprint 0 đến Sprint 2 đã xong. 110 unit test đạt.

Đã kiểm chứng trên **bản cài đặt thật** (`%LOCALAPPDATA%\Programs\StandUp`): installer chạy trót lọt, tạo đủ shortcut Desktop + Start Menu, shortcut mang đúng AppUserModelID `vn.standup.app`. Bật "khởi động cùng Windows" ghi đúng khoá registry `vn.standup.app = "…\StandUp.exe" --hidden`; tắt thì gỡ sạch.

**Toast notification: đã giải quyết.** Triệu chứng ban đầu (toast vào Action Center nhưng banner không hiện) được chẩn đoán bằng thí nghiệm đối chứng: banner PowerShell hiện bình thường → lỗi nằm ở riêng AUMID của app → đăng ký AUMID qua registry thì banner hiện ngay. Cơ chế tự đăng ký đã đưa vào app (xem Ghi chú kỹ thuật). Onboarding cũng đã kiểm chứng chạy đúng trên bản cài đặt với người dùng mới.

Còn lại trước khi phát hành 1.0:

- [ ] Thử trên máy sạch (chưa từng cài Node/Electron): cài đặt, toast banner phải mang tên "StandUp" — trên máy dev tên còn hiện `vn.standup.app` vì database thông báo đã cache danh tính từ các toast test bắn trước khi có khoá đăng ký; máy sạch không có vết cache đó.
- [ ] Beta 5–10 người dùng thật (Sprint 3)

## Bản 1.1 (sau MVP)

- [ ] Overlay nghỉ toàn màn hình kèm gợi ý giãn cơ
- [ ] Chế độ Không làm phiền tự động (phát hiện fullscreen/thuyết trình)
- [ ] Lịch làm việc theo khung giờ và ngày trong tuần
- [ ] Thống kê ngày/tuần, tỉ lệ tuân thủ
