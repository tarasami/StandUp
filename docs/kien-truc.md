# Kiến trúc

Tài liệu này giải thích **vì sao** mã nguồn được chia như hiện tại, đủ để bạn sửa một tính
năng mà không phải đọc hết mọi file.

- [Ý tưởng cốt lõi](#ý-tưởng-cốt-lõi)
- [State machine](#state-machine)
- [Effect](#effect)
- [Vòng tick 1 giây](#vòng-tick-1-giây)
- [Bốn cửa sổ](#bốn-cửa-sổ)
- [Cầu IPC](#cầu-ipc)
- [Cài đặt](#cài-đặt)
- [Nhật ký](#nhật-ký)
- [Muốn thêm tính năng thì sửa ở đâu](#muốn-thêm-tính-năng-thì-sửa-ở-đâu)

---

## Ý tưởng cốt lõi

> **Mọi logic nghiệp vụ nằm trong một state machine thuần, không biết Electron là gì.**

```
                    ┌──────────────────────────────────────┐
   thời gian  ──►   │           engine.js (THUẦN)          │  ──►  danh sách EFFECT
   idleSecs   ──►   │  phase, hạn chót, chọn câu nhắc,     │       [{type:'openReminder'},
   canNotify  ──►   │  chọn động tác giãn cơ, clampSettings │        {type:'sound', kind:…}]
                    └──────────────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │        main.js (tầng Electron)       │
                    │  chỉ THỰC THI effect: mở/đóng cửa sổ,│
                    │  bắn toast, phát âm, vẽ tray icon    │
                    └──────────────────────────────────────┘
```

`engine.js` **không `require('electron')`**. Đó không phải chuyện thẩm mỹ mà là điều kiện
để test: `npm test` chạy bằng Node thuần, mô phỏng 3 tiếng đồng hồ trong vài mili giây bằng
cách gọi `tick()` với các mốc thời gian tự chế.

Lý do thực tế đằng sau lựa chọn này: **mọi lỗi thật của dự án đều nằm ở tầng Electron**,
chưa lỗi nào ở engine. Vì vậy nguyên tắc là — hàm nào tách ra khỏi Electron được thì tách
sang `main-utils.js` để có test.

---

## State machine

Năm pha, trong `electron/engine.js`:

| Pha | Nghĩa | Ra khỏi pha khi |
|---|---|---|
| `working` | Đang làm việc, đếm ngược tới lần nhắc | Hết chu kỳ → `reminding`; rời máy quá lâu → `idle` |
| `reminding` | Cửa sổ nhắc đang hiện, chờ bạn chọn | Bạn bấm nút; rời máy → `idle`; **phớt lờ quá 3' → tự hoãn** |
| `breaking` | Đang trong giờ nghỉ (có/không có màn che) | Hết giờ nghỉ → `working`; bấm bỏ qua → `working` |
| `idle` | App cho rằng bạn đã rời máy | Bạn chạm chuột/phím trở lại → chu kỳ mới |
| `paused` | Bạn chủ động tạm dừng | Hết hạn tạm dừng, hoặc bấm *Tiếp tục* |

Vài quyết định đáng chú ý:

**Đếm bằng timestamp tuyệt đối, không đếm số tick.** `deadline = now + intervalMs`. Nếu đếm
bằng cách trừ dần mỗi giây thì máy ngủ 3 tiếng sẽ chỉ trôi vài giây trong đồng hồ của app.
Đổi lại phải xử lý trường hợp **đồng hồ hệ thống nhảy lùi** (`rebaseIfClockWentBack`), nếu
không thì chỉnh giờ máy về quá khứ sẽ khiến app im hàng tiếng.

**Không bao giờ kẹt ở `reminding`.** Người dùng có thể bỏ mặc cửa sổ nhắc trên màn hình rồi
đi mất. Quá 3 phút (`IGNORED_RENAG_SECS`) app tự đóng cửa sổ và hoãn — thà nhắc lại sau còn
hơn treo một cửa sổ chết rồi im vĩnh viễn.

**Rời máy được tính là đã nghỉ.** Đứng dậy bỏ đi ngay sau khi bị nhắc cũng được ghi nhận —
người dùng không phải bấm gì để "chứng minh" là mình đã nghỉ.

---

## Effect

`tick()` và các hành động (`takeBreak`, `snooze`, `skip`, `breakNow`, `pause`, `resume`…)
đều **không tự làm gì cả** — chúng trả về một mảng effect để tầng Electron thực thi:

| Effect | Tầng Electron làm gì |
|---|---|
| `openReminder` | Hiện cửa sổ nhắc nổi (`showInactive` — không cướp focus) |
| `closeReminder` | Ẩn cửa sổ nhắc |
| `openOverlay` | Bung màn nghỉ che màn hình (có `focus()` để phím `Esc` chạy được) |
| `closeOverlay` | Ẩn màn nghỉ |
| `sound` | Gửi xuống renderer cửa sổ chính để phát bằng Web Audio |
| `notify` | Bắn toast Windows (chỉ dùng lúc hết giờ nghỉ và xong onboarding) |

Quy tắc bất di bất dịch: **`closeOverlay` phải có mặt ở MỌI lối ra khỏi giờ nghỉ** — hết
giờ, bấm bỏ qua, tạm dừng, máy ngủ dậy. Một cửa sổ che kín màn hình mà kẹt lại là kiểu hỏng
tệ nhất mà app này có thể gây ra, nên ngoài việc rải effect còn có **lưới đỡ** trong
`broadcast()` của `main.js`: hễ trạng thái không phải `breaking` mà overlay còn hiện thì
đóng ngay lập tức.

---

## Vòng tick 1 giây

`main.js` gọi `engine.tick(Date.now(), idleSecs, canNotify)` mỗi giây:

- `idleSecs` ← `powerMonitor.getSystemIdleTime()` (tương đương `GetLastInputInfo` của Win32).
- `canNotify` ← Windows có đang bận không (toàn màn hình / trình chiếu / game). Tra bằng
  `SHQueryUserNotificationState`, **chỉ hỏi khi còn ≤15 giây tới hạn nhắc** cho đỡ tốn tài
  nguyên, có cache + throttle, và **fail-open**: tra cứu lỗi thì coi như được phép nhắc.
  Xem [ghi chú kỹ thuật](ghi-chu-ky-thuat.md#nhường-toàn-màn-hình).

Sau mỗi tick, `broadcast()` đẩy trạng thái mới xuống mọi cửa sổ đang mở và cập nhật tray
icon (vẽ lại số phút còn lại, đổi màu theo pha).

---

## Bốn cửa sổ

| Cửa sổ | Tệp | Đặc tính |
|---|---|---|
| Chính | `src/index.html` | Kích thước cố định, co/giãn một trục khi xổ cài đặt. Đóng = thu về tray. |
| Nhắc | `src/reminder.html` | Frameless, always-on-top, **`showInactive`** để không cướp focus lúc bạn đang gõ |
| Màn nghỉ | `src/overlay.html` | Phủ trọn `bounds` màn hình đang có con trỏ (không dùng `workArea` — chừa taskbar ra thì nó trông như một cửa sổ to và người dùng bấm sang app khác). **Có `focus()`** vì phím `Esc` chỉ chạy khi cửa sổ được focus. |
| Onboarding | `src/onboarding.html` | Chỉ hiện lần chạy đầu |

Cả bốn đều bật `contextIsolation`, tắt `nodeIntegration`, và chỉ nói chuyện với main process
qua `preload.js`.

Cửa sổ chính và cửa sổ nhắc dùng `screen.getDisplayNearestPoint(getCursorScreenPoint())` chứ
không dùng màn hình chính: trên máy nhiều màn hình, nhắc ở màn hình bạn *không* nhìn thì coi
như không nhắc.

**Đổi chiều cao cửa sổ thì phải kẹp lại vị trí.** Cửa sổ chính cao thêm ~480px khi xổ cài
đặt; nếu chỉ gọi `setSize` thì phần thêm mọc xuống dưới và tràn khỏi màn hình, nuốt mất nút
*Lưu cài đặt*. `clampWindowY()` trong `main-utils.js` đẩy cửa sổ lên vừa đủ để lọt vùng làm
việc — không hơn, vì người dùng kê cửa sổ ở đâu thì tôn trọng chỗ đó.

---

## Cầu IPC

Toàn bộ bề mặt tiếp xúc giữa renderer và main, khai báo trong `electron/preload.js`:

```js
window.standup = {
  getStatus(),            // → trạng thái hiện tại (pha, thời gian còn lại, động tác giãn cơ)
  getSettings(),          // → cài đặt đang dùng
  setSettings(s),         // → cài đặt sau khi đã kẹp về dải hợp lệ
  getEnv(),               // → { packaged: bool } — UI cần biết để ghi chú về autostart
  completeOnboarding(s),  // kết thúc màn hình lần chạy đầu
  action(name),           // 'takeBreak' | 'snooze' | 'skip' | 'breakNow' | 'test' | 'pause1h' | 'pauseIndef' | 'resume'
  toggleSettings(open),   // báo main để cửa sổ co/giãn cho vừa nội dung
  onStatus(cb),           // main đẩy trạng thái xuống mỗi giây
  onSound(cb),            // main yêu cầu phát âm báo
};
```

Chiều cao cửa sổ do **main** giữ (`HEIGHTS` trong `main.js`), không đo pixel ở renderer —
một chỗ giữ số đo thì không bao giờ lệch nhau.

---

## Cài đặt

Lưu ở `%APPDATA%\standup\settings.json`. Mọi giá trị đi qua `clampSettings()` trong
`engine.js` — cả lúc đọc từ đĩa lẫn lúc nhận từ UI:

- Số ngoài dải → **kẹp về biên** (gõ 999 phút → 240).
- Giá trị sai kiểu, chuỗi rác, thiếu khoá → rơi về mặc định.
- File hỏng, không phải JSON, hoặc **dính BOM** → `parseSettingsJson()` trả `null`, app dùng
  mặc định thay vì chết. (BOM là ca thật: sửa file bằng trình soạn thảo Windows rất dễ dính,
  và `JSON.parse` ném lỗi vì nó — hậu quả là mất sạch cài đặt mà không một lời báo.)

---

## Nhật ký

`%APPDATA%\standup\standup.log`, **luôn bật**, tự xoay vòng khi vượt ~1MB (`standup.log.1`).

Ghi: khởi động (kèm toàn bộ cài đặt), đổi cài đặt, chuyển pha, thao tác người dùng, máy
ngủ/thức, Windows bận/rảnh, và **mọi sự cố ngoài dự tính** — `uncaughtException`,
`unhandledRejection`, renderer chết (nêu rõ cửa sổ nào), tiến trình con chết.

Vì sao ghi log thay vì hiện hộp thoại lỗi: đây là app chạy nền: một hộp thoại nhảy ra giữa
lúc người dùng đang làm việc còn tệ hơn chính cái lỗi. Có log thì lúc cần vẫn soi lại được.

---

## Muốn thêm tính năng thì sửa ở đâu

| Bạn muốn | Sửa ở |
|---|---|
| Đổi luật nhắc / thêm pha / đổi cách tính hạn | `engine.js` + test trong `test/engine.test.js` |
| Thêm câu nhắc hoặc động tác giãn cơ | `REMIND_MESSAGES` / `STRETCH_IDEAS` trong `engine.js` |
| Vẽ hình động cho một động tác mới | `src/overlay.html` (hình) + `@keyframes` trong `src/styles.css` + bảng `SPECIAL` trong `src/overlay.js` |
| Thêm một ô cài đặt | `DEFAULT_SETTINGS` + `clampSettings` (engine) → `src/index.html` → `HEIGHTS.full` trong `main.js` |
| Đổi cách cửa sổ hiện ra | `main.js` (`showReminder` / `showOverlay` / `fitMain`) |
| Logic tính toán thuần bất kỳ | Ưu tiên `main-utils.js` để có test |

Thêm ô cài đặt thì **nhớ chỉnh `HEIGHTS.full`** — nội dung cao lên mà chiều cao cửa sổ giữ
nguyên thì nút *Lưu* bị đẩy ra ngoài. Cách đo: mở DevTools, lấy `document.documentElement.scrollHeight`
lúc cài đặt đang xổ, cộng 39px viền cửa sổ Windows.
