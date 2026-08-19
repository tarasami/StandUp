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
- 🔔 Khi tới giờ: **cửa sổ nhắc nổi** góc màn hình (không cướp focus) với 3 nút **Nghỉ ngay / Hoãn 5' / Bỏ qua**. Đây là kênh nhắc **duy nhất** lúc tới giờ — không bắn toast Windows (dễ bị hệ thống nuốt ngầm). Lời nhắc bị **phớt lờ quá 3 phút** sẽ tự đóng và **hoãn 5'**, để app không kẹt mãi ở màn nhắc rồi im luôn.
- 🧘 **Màn nghỉ che màn hình** (bật/tắt được, mặc định bật): mỗi lần nghỉ hiện **một động tác giãn cơ** kèm **hình động** — 8 động tác xoay vòng (vai, cổ, lưng, cổ tay, mắt, chân) vẽ bằng SVG/CSS, không file nặng — cùng đồng hồ đếm ngược; thoát bằng **Esc** hoặc nút **Làm việc tiếp**. Tắt công tắc thì giờ nghỉ chỉ đếm ngược ở cửa sổ nhỏ như cũ. Hết giờ nghỉ tự bắt đầu chu kỳ mới.
- 👣 **Idle detection**: rời máy quá N phút (mặc định 5') → tự coi là đã nghỉ, quay lại máy là chu kỳ mới tự chạy. Đứng dậy bỏ đi ngay sau khi được nhắc cũng được tự ghi nhận — không cần bấm gì.
- 📌 Tray icon **hiện số phút còn lại ngay trên icon** (đổi màu theo trạng thái: xanh = đang làm việc, vàng = nhắc/nghỉ, xám = rời máy/tạm dừng); tooltip chi tiết; menu Nghỉ ngay / Thử nhắc nhở / Tạm dừng 1 giờ / Tạm dừng vô thời hạn / Tiếp tục / Thoát.
- 🎉 **Onboarding 1 màn hình** cho lần chạy đầu: chọn khoảng nhắc (preset 30/45/60 hoặc tự nhập, đồng bộ hai chiều), bật/tắt khởi động cùng Windows và âm báo, kèm hướng dẫn ghim icon tray. Bấm **Bắt đầu** là app thu vào khay và đếm luôn.
- 🚀 **Khởi động cùng Windows** (`app.setLoginItemSettings`), chạy ẩn bằng cờ `--hidden` để không bung cửa sổ lúc đăng nhập.
- 💬 **12 câu nhắc xoay vòng** (và 4 câu báo hết giờ nghỉ) — không lặp lại trước khi dùng hết bộ, tránh nhàm.
- 🔔 **Âm báo nhẹ** tổng hợp bằng Web Audio (2 nốt sine, không cần file nhạc): đi lên khi nhắc, đi xuống khi hết giờ nghỉ. Tắt được trong cài đặt.
- 🎮 **Nhường toàn màn hình** (bật/tắt được, mặc định bật): đang xem phim, chơi game full-screen hay trình chiếu thì hoãn lời nhắc tới khi bạn xong — hỏi thẳng Windows qua `SHQueryUserNotificationState` chứ không tự đoán, và *fail-open* (tra cứu lỗi thì vẫn nhắc). Tắt công tắc này nếu muốn được nhắc kể cả lúc đang cày lâu.
- 🧾 **Nhật ký sự kiện luôn bật** tại `%APPDATA%/standup/standup.log` (tự xoay vòng ~1MB → `standup.log.1`): ghi khởi động, đổi cài đặt, chuyển trạng thái, ngủ/thức máy, và **mọi sự cố ngoài dự tính** (lỗi không bắt, renderer/tiến trình con chết) — để soi lại khi có trục trặc, thay cho hộp thoại lỗi phá ngang app nền.
- ⚙️ Cài đặt lưu tại `%APPDATA%/standup/settings.json`.
- Đóng cửa sổ chính = thu về tray, app vẫn chạy nền. Thoát hẳn qua menu tray.

## Cấu trúc mã

```
electron/
  engine.js      # State machine thuần + bộ câu nhắc + clampSettings — unit-test được
  main-utils.js  # Hàm thuần tách khỏi main (parse cài đặt, vị trí cửa sổ, định dạng & xoay log, đọc trạng thái thông báo) — unit-test được
  main.js        # Main process: tray, cửa sổ, powerMonitor, vòng tick 1s, nhật ký, nhường full màn hình
  preload.js     # contextBridge — cầu IPC an toàn cho renderer
src/
  index.html     # Cửa sổ chính: trạng thái + cài đặt (gọn, xổ ra khi bấm ⚙)
  onboarding.html# Màn hình lần chạy đầu
  reminder.html  # Cửa sổ nhắc nổi (frameless, always-on-top)
  overlay.html   # Màn nghỉ che màn hình + hình động giãn cơ (SVG/CSS): hình que
                 #   nhìn thẳng, hình nhìn nghiêng (gập lưng), hình mắt
  overlay.js     # Chọn hình theo động tác (que người / mắt / emoji)
tools/
  make-icon.js   # Sinh icon.ico 7 kích thước, không cần thư viện ngoài
test/
  engine.test.js      # 186 kiểm tra — engine thuần
  main-utils.test.js  # 48 kiểm tra — hàm thuần tách khỏi main
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
- **Lời nhắc tới giờ không còn dùng toast Windows** — chỉ mở cửa sổ nhắc nổi (có nút hành động, không bị hệ thống nuốt ngầm). Toast **giờ chỉ còn dùng lúc hết giờ nghỉ và xong onboarding** (hai chỗ không có cửa sổ nào khác báo). Vì hai chỗ đó vẫn cần banner nên phần đăng ký AUMID dưới đây vẫn giữ.
- **Toast banner cần đăng ký AUMID qua registry.** Shortcut Start Menu mang AppUserModelID (cơ chế electron-builder tạo sẵn) là KHÔNG đủ trên mọi máy: đã gặp trường hợp toast vào Action Center nhưng banner không bật. App tự ghi khoá `HKCU\Software\Classes\AppUserModelId\vn.standup.app` (DisplayName kiểu REG_EXPAND_SZ + IconUri) mỗi lần khởi động bản đóng gói (`registerAumid()` trong main.js); uninstaller dọn khoá này (`build/installer.nsh`). Chẩn đoán toast khi cần: `SHQueryUserNotificationState` cho trạng thái hệ thống, `ToastNotificationManager::History.GetHistory(aumid)` chứng minh việc giao nhận không phụ thuộc banner có hiện hay không.
- **Nhường toàn màn hình hỏi Windows chứ không tự đoán.** `SHQueryUserNotificationState` (shell32) trả 1–7; chỉ `5 = QUNS_ACCEPTS_NOTIFICATIONS` mới cho nhắc, còn 2 (app full-screen: video/trình chiếu), 3 (game D3D), 4 (chế độ trình chiếu)… thì hoãn. Gọi qua PowerShell `-EncodedCommand` (base64 UTF-16LE, tránh lỗi trích dẫn lồng, kèm `$ProgressPreference='SilentlyContinue'` cho stdout sạch), `execFile` **bất đồng bộ** + cache + throttle, và **fail-open** (truy vấn lỗi/timeout → vẫn nhắc) để một sự cố tra cứu không bao giờ khiến app im mãi. Chỉ hỏi khi sắp tới giờ nhắc (trong ~15s) cho đỡ tốn tài nguyên. Bẫy tự kiểm: cửa sổ full-screen sinh trong tiến trình nền phải gọi `app.focus({ steal: true })` mới được Windows tính là QUNS_BUSY (chống cướp foreground).
- **Hình giãn cơ trong màn nghỉ vẽ bằng SVG/CSS, không file ảnh/video** (đúng lối `make-icon.js` — vẽ bằng code thay vì ship asset): mỗi hình vài KB, offline, sửa & dịch dễ, hợp định vị "nhẹ & sạch". Xoay quanh khớp (cổ, vai, hông…) bằng `transform-origin` (px) + **`transform-box: view-box`** để tính theo hệ toạ độ viewBox — thiếu `transform-box` thì khớp quay lệch. Ba kiểu hình: que nhìn thẳng (6 động tác), **nhìn nghiêng** cho gập lưng (gập người về phía trước mà vẽ nhìn thẳng thì chỉ thấy người co lại, không đọc ra được — hình nghiêng còn cho cánh tay xoay ngược đúng bằng góc gập để luôn buông thẳng theo trọng lực), và hình mắt riêng cho nghỉ mắt vì que người không có mặt. Vươn người phải dùng cặp tay DÀI riêng: tay ngắn giơ lên vẫn không vượt khỏi đỉnh đầu nên chỉ ra dáng chữ V. Màn nghỉ **luôn có lối thoát** (Esc + nút) và có lưới đỡ trong `broadcast()`: không còn nghỉ mà overlay còn hiện thì đóng ngay — một cửa sổ che kín màn hình mà kẹt lại là hỏng nặng nhất. Bẫy đo lường: động tác có đoạn "giữ" dài (gập lưng) mà lấy mẫu góc trong cửa sổ **ngắn** dễ rơi trúng đoạn giữ → tưởng đứng im; phải lấy mẫu trọn một chu kỳ. Tôn trọng `prefers-reduced-motion` (hình đứng yên).

## Trạng thái

Đủ **8/8 hạng mục MVP** trong [PLAN.md](PLAN.md) — Sprint 0 đến Sprint 2 đã xong. **234 unit test đạt** (186 engine + 48 hàm tách khỏi main).

Đã kiểm chứng trên **bản cài đặt thật** (`%LOCALAPPDATA%\Programs\StandUp`): installer chạy trót lọt, tạo đủ shortcut Desktop + Start Menu, shortcut mang đúng AppUserModelID `vn.standup.app`. Bật "khởi động cùng Windows" ghi đúng khoá registry `vn.standup.app = "…\StandUp.exe" --hidden`; tắt thì gỡ sạch.

**Toast notification: đã giải quyết.** Triệu chứng ban đầu (toast vào Action Center nhưng banner không hiện) được chẩn đoán bằng thí nghiệm đối chứng: banner PowerShell hiện bình thường → lỗi nằm ở riêng AUMID của app → đăng ký AUMID qua registry thì banner hiện ngay. Cơ chế tự đăng ký đã đưa vào app (xem Ghi chú kỹ thuật). Onboarding cũng đã kiểm chứng chạy đúng trên bản cài đặt với người dùng mới.

**Gia cố sau MVP (đều đã test kỹ trên app chạy thật + cài đặt thật, rồi commit/đẩy):**

- Lời nhắc bỏ hẳn toast Windows, chỉ dùng cửa sổ nhắc nổi (`ad154af`); gỡ luôn hệ thống cảnh báo "Windows chặn thông báo" đã hết tác dụng (`9766ed9`).
- Nhật ký sự kiện luôn bật `standup.log` (`7e05eed`) + bắt mọi sự cố ngoài dự tính vào log thay cho hộp thoại lỗi (`99c37c9`).
- Tự hoãn lời nhắc bị phớt lờ quá 3' để app không kẹt ở màn nhắc rồi im luôn (`99c37c9`).
- Nhường toàn màn hình khi xem phim/chơi game/trình chiếu, kèm công tắc bật/tắt (`56b263b`, `19e839b`).
- **Màn nghỉ che màn hình kèm hình giãn cơ** (kéo sớm từ v1.1): mỗi lần nghỉ một trong 8 động tác + hình động vẽ bằng SVG/CSS, có công tắc tắt, thoát bằng Esc.

Còn lại trước khi phát hành 1.0:

- [ ] Thử trên máy sạch (chưa từng cài Node/Electron): cài đặt, toast banner phải mang tên "StandUp" — trên máy dev tên còn hiện `vn.standup.app` vì database thông báo đã cache danh tính từ các toast test bắn trước khi có khoá đăng ký; máy sạch không có vết cache đó.
- [ ] Beta 5–10 người dùng thật (Sprint 3)

## Bản 1.1 (sau MVP)

- [x] ~~Chế độ Không làm phiền tự động (phát hiện fullscreen/thuyết trình)~~ — **đã làm sớm trong 1.0**, bật/tắt được. Chưa gồm phát hiện gọi video **cửa sổ** (Zoom/Meet không full-screen) — chỗ này Windows không báo bận.
- [x] ~~Overlay nghỉ toàn màn hình kèm gợi ý giãn cơ~~ — **đã làm sớm trong 1.0**: màn nghỉ che màn hình, 8 động tác giãn cơ + hình động (SVG/CSS), bật/tắt được, thoát bằng Esc.
- [ ] Lịch làm việc theo khung giờ và ngày trong tuần
- [ ] Thống kê ngày/tuần, tỉ lệ tuân thủ
