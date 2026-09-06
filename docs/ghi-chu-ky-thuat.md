# Ghi chú kỹ thuật

Những cái bẫy đã gặp thật khi làm app nền cho Windows bằng Electron, kèm cách xử lý và **lý
do** đằng sau. Phần lớn không có trong tài liệu chính thức — chúng lộ ra khi thử trên máy
thật, và mỗi mục dưới đây đều từng ngốn nhiều giờ.

- [Toast và AUMID](#toast-và-aumid)
- [Nhường toàn màn hình](#nhường-toàn-màn-hình)
- [Idle detection](#idle-detection)
- [Khởi động cùng Windows](#khởi-động-cùng-windows)
- [Âm báo bằng Web Audio](#âm-báo-bằng-web-audio)
- [Hình động vẽ bằng SVG/CSS](#hình-động-vẽ-bằng-svgcss)
- [Kích thước và vị trí cửa sổ](#kích-thước-và-vị-trí-cửa-sổ)
- [Bản dev tranh chấp với bản đã cài](#bản-dev-tranh-chấp-với-bản-đã-cài)
- [Đóng gói NSIS](#đóng-gói-nsis)

---

## Toast và AUMID

**Triệu chứng:** toast vào được Action Center nhưng **banner không bật lên**. Người dùng
tưởng app hỏng, thực ra thông báo vẫn được giao — chỉ là không hiện.

**Chẩn đoán:** thí nghiệm đối chứng — bắn toast bằng PowerShell (banner hiện bình thường)
so với bắn từ app (không hiện). Kết luận: lỗi nằm ở riêng **AppUserModelID** của app, không
phải ở cấu hình thông báo của Windows.

**Nguyên nhân:** shortcut Start Menu mang AUMID (cơ chế electron-builder tạo sẵn) là **không
đủ trên mọi máy**. Windows cần tra được danh tính ứng dụng để quyết định hiện banner.

**Cách xử lý:** app tự ghi khoá registry mỗi lần khởi động bản đóng gói (`registerAumid()`
trong `main.js`):

```
HKCU\Software\Classes\AppUserModelId\vn.standup.app
  DisplayName  (REG_EXPAND_SZ)  = StandUp
  IconUri                       = <đường dẫn icon>
```

`DisplayName` phải là **`REG_EXPAND_SZ`**, không phải `REG_SZ`. Trình gỡ cài đặt dọn khoá
này qua `build/installer.nsh`.

**Bẫy khi tự kiểm:** Windows **cache danh tính** trong database thông báo. Máy đã từng nhận
toast từ app *trước khi* có khoá đăng ký sẽ tiếp tục hiện tên cũ dù đã sửa đúng — nên phải
thử trên máy sạch mới kết luận được. (Đừng xoá `wpndatabase` để "làm sạch": nó chứa lịch sử
thông báo của toàn bộ hệ thống.)

**Công cụ chẩn đoán hữu ích:** `ToastNotificationManager::History.GetHistory(aumid)` chứng
minh toast **có được giao hay không**, độc lập với việc banner có hiện hay không — tách bạch
hai vấn đề rất khác nhau.

> Trong StandUp, lời nhắc tới giờ **cố tình không dùng toast**. Toast dễ bị hệ thống nuốt
> ngầm, mà lời nhắc là chức năng cốt lõi. Kênh chính là cửa sổ nhắc nổi. Toast chỉ còn dùng
> ở hai chỗ không có cửa sổ nào khác báo: hết giờ nghỉ và xong onboarding.

---

## Nhường toàn màn hình

Không nên tự đoán "người dùng chắc đang bận". Windows đã có sẵn câu trả lời:
**`SHQueryUserNotificationState`** (shell32) trả về 1–7:

| Giá trị | Nghĩa | StandUp làm gì |
|---|---|---|
| 1 | Khoá máy / screensaver | Hoãn |
| 2 | App full-screen (video, trình chiếu) | Hoãn |
| 3 | Game D3D full-screen | Hoãn |
| 4 | Chế độ trình chiếu | Hoãn |
| **5** | **Bình thường** | **Nhắc** |
| 6 | Quiet time | Hoãn |
| 7 | App Store full-screen | Hoãn |

Bốn điểm quan trọng khi hiện thực:

1. **Fail-open.** Tra cứu lỗi, timeout, hay trả về giá trị ngoài dải 1–7 → **vẫn nhắc**. Một
   sự cố tra cứu không bao giờ được phép khiến app im vĩnh viễn — đó là kiểu hỏng mà người
   dùng không bao giờ báo, chỉ lặng lẽ ngừng dùng.
2. **Gọi qua PowerShell `-EncodedCommand`** (base64 UTF-16LE). Tránh hoàn toàn địa ngục
   trích dẫn lồng nhau. Kèm `$ProgressPreference = 'SilentlyContinue'` để stdout sạch, không
   lẫn thanh tiến trình.
3. **`execFile` bất đồng bộ**, có cache và throttle, và **chỉ hỏi khi còn ≤15 giây tới hạn
   nhắc**. Spawn một PowerShell mỗi giây suốt cả ngày là không chấp nhận được.
4. **Bẫy khi tự kiểm:** cửa sổ full-screen do một tiến trình **nền** tạo ra sẽ **không**
   được Windows tính là bận — chống cướp foreground. Phải gọi `app.focus({ steal: true })`
   thì `SHQueryUserNotificationState` mới trả về 2.

**Chưa giải quyết được:** gọi video ở **cửa sổ** (Zoom/Meet không full-screen). Windows
không coi đó là bận, nên không có tín hiệu nào để dựa vào.

---

## Idle detection

`powerMonitor.getSystemIdleTime()` của Electron — tương đương `GetLastInputInfo` của Win32,
trả về số giây kể từ lần cuối có input. Không biết bạn gõ gì, chỉ biết có gõ hay không.

**Bẫy khi tự kiểm:** `SetCursorPos` **không được Windows tính là input** — di chuột bằng
`SetCursorPos` trong script test thì idle time vẫn tăng đều, dễ kết luận nhầm là tính năng
hỏng. Phải dùng `mouse_event` hoặc `SendInput`.

---

## Khởi động cùng Windows

`app.setLoginItemSettings()` ghi vào `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.

**Tên giá trị là AppUserModelID (`vn.standup.app`), không phải tên app (`StandUp`).** Đã một
lần kết luận nhầm "installer xoá mất autostart" chỉ vì dò sai tên khoá. (Kiểm chứng lại:
template NSIS của electron-builder không hề đụng tới khoá `Run`.)

**Chỉ bật ở bản đóng gói.** `applyAutoStart()` tự bỏ qua khi `!app.isPackaged` — nếu không,
mục khởi động sẽ trỏ vào `electron.exe` trong `node_modules`; xoá thư mục đó là để lại một
mục khởi động chết trong registry của người dùng. Giao diện có ghi chú tương ứng.

Chạy ẩn lúc đăng nhập bằng cờ `--hidden` để không bung cửa sổ vào mặt người dùng.

---

## Âm báo bằng Web Audio

Âm báo tổng hợp bằng `AudioContext` (hai nốt sine — đi lên khi nhắc, đi xuống khi hết giờ
nghỉ), không cần tệp nhạc nào.

Hai chỗ rất dễ sai:

1. **Phải `await ctx.resume()` TRƯỚC khi lên lịch nốt.** Lên lịch lúc context còn ngủ thì
   không nốt nào kêu, và không có lỗi nào được ném ra.
2. **Cần switch `autoplay-policy=no-user-gesture-required`** — âm phát do hết giờ, không do
   người dùng bấm, nên chính sách autoplay mặc định sẽ chặn.

Cửa sổ chính đặt `backgroundThrottling: false` vì nó phát âm ngay cả khi đang ẩn trong tray;
không tắt throttle thì Chromium hạ tần suất và âm báo hỏng thầm lặng.

Vì lỗi ở đây rất "im lặng", `applyEffects` có phần chẩn đoán bật bằng `STANDUP_DEBUG`: lấy
mẫu `webContents.isCurrentlyAudible()` ở nhiều mốc thời gian (150ms → 1400ms). Bộ đo độ ồn
của Chromium có độ trễ — lấy một mốc duy nhất cho rất nhiều âm tính giả.

---

## Hình động vẽ bằng SVG/CSS

8 động tác giãn cơ đều được **vẽ bằng mã**, không một tệp ảnh hay video: mỗi hình vài KB,
chạy offline, sửa và dịch dễ.

**`transform-box: view-box` là bắt buộc.** Muốn xoay quanh một khớp (vai, hông, cổ) bằng
`transform-origin` theo toạ độ px của viewBox thì phải đặt `transform-box: view-box`; thiếu
nó, trình duyệt tính origin theo bounding box của chính phần tử và khớp quay lệch hẳn.

**`prefers-reduced-motion` phải liệt kê cả phần tử gốc, không chỉ con:**

```css
/* SAI — không chặn được animation nằm trên chính .ov-side (phần căn khung) */
@media (prefers-reduced-motion: reduce) { .ov-side * { animation: none !important; } }

/* ĐÚNG */
@media (prefers-reduced-motion: reduce) {
  .ov-fig, .ov-fig *, .ov-side, .ov-side *, .ov-eyes, .ov-eyes * { animation: none !important; }
}
```

Đây là lỗi thật đã lọt qua vòng kiểm đầu: thân người đứng yên đúng như mong đợi, nhưng cả
hình vẫn **trượt ngang 18px** vì animation căn khung nằm trên chính phần tử gốc.

**Ba kiểu hình, không phải một.** Ban đầu định dùng chung một hình que nhìn thẳng cho cả 8
động tác. Không được:

- **Gập lưng** vẽ ở góc nhìn thẳng thì chỉ thấy người co lại — không đọc ra động tác. Phải
  có hình **nhìn nghiêng** riêng. Hình nghiêng còn cho phép xoay cánh tay **ngược đúng bằng
  góc gập thân**, để tay luôn buông thẳng theo trọng lực.
- **Nghỉ mắt** không vẽ được bằng người que (que không có mặt) → hình mắt riêng.
- **Vươn người** cần **cặp tay dài riêng**: tay ngắn dùng cho các động tác khác, khi giơ lên
  vẫn không vượt khỏi đỉnh đầu, nên chỉ ra dáng chữ V chứ không thành "vươn". Góc cũng phải
  chỉnh: 185° làm hai tay đè lên đầu thành mái lều, 173° mới ra hai tay song song thẳng lên.

**Bẫy khi đo "hình có động không":** động tác có đoạn **giữ** dài (gập lưng giữ 60° khá lâu)
mà lấy mẫu góc trong một cửa sổ **ngắn** thì rất dễ rơi trúng đoạn giữ → kết luận nhầm là
hình đứng im. Phải lấy mẫu trọn một chu kỳ. Xem [docs/kiem-thu.md](kiem-thu.md).

---

## Kích thước và vị trí cửa sổ

**Trên Windows, `setSize`/`setBounds` bị bỏ qua với cửa sổ `resizable: false`.** Phải mở
khoá tạm:

```js
mainWin.setResizable(true);
mainWin.setBounds({ x, y, width, height });
mainWin.setResizable(false);
```

**Đổi chiều cao thì phải kẹp lại vị trí.** Cửa sổ giãn **xuống dưới**. Cửa sổ chính cao từ
384 lên 864px khi xổ cài đặt; nằm giữa màn hình 1080 (y=328) thì đáy tới 1192 trong khi vùng
làm việc chỉ tới 1040 — nút *Lưu cài đặt* rơi ra ngoài màn hình, không bấm được. Dùng
`clampWindowY()` để đẩy lên **vừa đủ**, không hơn.

**Windows kẹp cửa sổ lúc TẠO, nhưng không kẹp khi bạn gọi `setBounds`.** Cửa sổ onboarding
xin 710px trên màn hình DPI 150% (vùng làm việc 694 DIP) thì Windows tự cắt còn 694 — an
toàn. Cửa sổ chính gọi `setBounds` tay thì Windows tôn trọng nguyên số bạn đưa, kể cả khi nó
thò khỏi màn hình. Chính sự bất đối xứng này là nguồn gốc lỗi trên.

**Nhớ màn hình DPI cao.** Ở 150%, vùng làm việc chỉ còn 694 DIP — thấp hơn cả nội dung cài
đặt (825px). Lúc đó cửa sổ buộc phải bị kẹp và **nội dung phải cuộn được**, nếu không thì
vẫn mất nút. Thà cuộn còn hơn mất nút; nhưng phải kiểm chứng là nó cuộn thật.

**Cửa sổ nhắc và màn nghỉ dùng màn hình theo CON TRỎ**
(`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`), không dùng màn hình chính:
trên máy nhiều màn hình, nhắc ở màn hình người dùng không nhìn thì coi như không nhắc.

Màn nghỉ phủ **`bounds`** chứ không phải `workArea`: chừa taskbar ra thì nó trông như một
cửa sổ to đùng và người dùng bấm luôn sang app khác — mất tác dụng.

Cửa sổ nhắc dùng **`showInactive`** (không cướp focus lúc bạn đang gõ) + `moveTop()` để nổi
lên đỉnh nhóm always-on-top. Màn nghỉ thì **phải** `focus()`, vì phím `Esc` chỉ chạy khi cửa
sổ đang được focus.

---

## Bản dev tranh chấp với bản đã cài

Bản đóng gói và bản chạy từ mã nguồn **dùng chung** `%APPDATA%\standup` (Windows không phân
biệt hoa thường giữa `standup` và `StandUp`), nên cũng chung khoá chống chạy trùng: mở bản
dev trong khi bản đã cài đang chạy thì bản dev **tự thoát** và chỉ hiện cửa sổ của bản cũ.

Rất dễ tưởng "code sửa rồi mà không ăn". Cách chạy tách biệt:

```bash
npx electron . --user-data-dir=.dev-profile
```

Phân biệt tiến trình: bản dev là `electron.exe`, bản đã cài là `StandUp.exe`.

**Bẫy liên quan khi đo cửa sổ bằng script:** hai bản có cửa sổ nhắc **cùng kích thước**
396×258. Script tìm cửa sổ theo kích thước sẽ vồ nhầm cửa sổ của bản kia. Phải lọc theo PID.
(Toạ độ đo được lệch ~8px so với `getBounds()` là do viền vô hình của DWM ở hai bên, không
phải lỗi.)

---

## Đóng gói NSIS

`npm run dist` → `dist/StandUp-Setup-<version>.exe`. Cấu hình trong `package.json`:
`oneClick: false` (cho chọn thư mục), `perMachine: false` (cài cho người dùng hiện tại,
không cần quyền admin), `deleteAppDataOnUninstall: false` (gỡ app không xoá cài đặt cá nhân).

**Ổ đĩa hệ thống gần đầy làm `makensis` chết** với `Internal compiler error #12345: error
creating mmap...`. Nguy hiểm ở chỗ bước `win-unpacked` vẫn xong nên dễ tưởng build thành
công — mà lần chạy hỏng đó **ghi đè mất installer cũ**. Cách chữa: trỏ `TEMP`/`TMP` sang ổ
còn chỗ rồi chạy lại.

**Cài đè làm reset công tắc thông báo.** Cài chồng lên bản đang có thì bước gỡ bản cũ khiến
Windows bỏ override `Enabled` trong `HKCU\...\Notifications\Settings\vn.standup.app` — công
tắc tắt/bật thông báo của người dùng trở về mặc định. Nên kiểm lại chỗ này sau mỗi lần cài đè.
