# Kiểm thử

```bash
npm test
```

Chạy bằng **Node thuần**, không cần Electron, xong trong chưa tới một giây. 242 kiểm tra
trong hai bộ.

- [Vì sao test được nhiều đến vậy](#vì-sao-test-được-nhiều-đến-vậy)
- [Bộ 1 — engine](#bộ-1--engine-186-kiểm-tra)
- [Bộ 2 — hàm thuần của main](#bộ-2--hàm-thuần-của-main-56-kiểm-tra)
- [Nghiệm trên app chạy thật](#nghiệm-trên-app-chạy-thật)
- [Những cái bẫy khi đo](#những-cái-bẫy-khi-đo)
- [Chưa test được](#chưa-test-được)

---

## Vì sao test được nhiều đến vậy

Vì `engine.js` **không import Electron**. Nó là một hàm thuần theo nghĩa: đưa vào
`(now, idleSecs, canNotify)`, nhận ra pha mới và danh sách effect. Nhờ đó test **mô phỏng
thời gian** — chạy giả lập 8 tiếng làm việc trong vài mili giây bằng cách gọi `tick()` với
các mốc thời gian tự chế:

```js
// Mô phỏng: máy ngủ 3 tiếng rồi mở lại
let t = START;
eng.tick(t, 0);
t += 3 * 60 * 60 * 1000;      // nhảy 3 tiếng, không cần đợi thật
const fx = eng.tick(t, 0);     // app phải biết là đã quá hạn từ lâu
```

Không mô phỏng được thời gian thì những ca như sleep/hibernate, đồng hồ nhảy lùi, hay chạy
liên tục 8 tiếng sẽ **không bao giờ được test** — mà đó chính là những chỗ dễ hỏng nhất.

Nguyên tắc kèm theo: **logic nào tách ra khỏi Electron được thì tách**, sang
`electron/main-utils.js`. Lý do rất thực tế — mọi lỗi thật của dự án này đều nằm ở tầng
Electron, chưa lỗi nào ở engine.

---

## Bộ 1 — engine (186 kiểm tra)

`test/engine.test.js`. Phủ theo tình huống thật chứ không theo từng hàm:

| Nhóm | Nội dung |
|---|---|
| 1–2 | Chu kỳ làm việc → nhắc → nghỉ → chu kỳ mới |
| 3 | Idle detection: biên chính xác của ngưỡng, rời máy ngay sau khi bị nhắc, rời máy giữa giờ nghỉ |
| 4 | **Sleep/hibernate** (khoảng trống thời gian lớn) và **đồng hồ hệ thống bị chỉnh lùi** (NTP, đổi múi giờ) |
| 5 | Hoãn, bỏ qua, hành động sai ngữ cảnh, **lời nhắc bị phớt lờ quá lâu → tự hoãn, không kẹt**, hoãn khi Windows bận |
| 6–7 | Tạm dừng (có hạn / vô hạn), đổi cài đặt giữa chừng |
| 8 | `clampSettings` chống dữ liệu rác; công tắc bool; âm chỉ phát khi bật; **không lặp câu nhắc** |
| 9 | Cấu hình biên (chu kỳ tối thiểu 5 phút) |
| 10–11 | **Chạy dài 8 tiếng** liên tục, và 8 tiếng với người dùng hay rời máy — soi rò rỉ trạng thái |
| 12 | Màn nghỉ: bật/tắt, `closeOverlay` ở **mọi** lối ra, xoay vòng động tác, bất biến "không bao giờ kẹt overlay" |

Đáng chú ý là nhóm 12 có một **bất biến** được kiểm ở mọi bước: *nếu pha không phải
`breaking` thì overlay phải đóng*. Cửa sổ che kín màn hình mà kẹt lại là kiểu hỏng tệ nhất
app này có thể gây ra, nên nó được canh bằng cả test lẫn lưới đỡ trong `broadcast()`.

---

## Bộ 2 — hàm thuần của main (56 kiểm tra)

`test/main-utils.test.js`:

| Nhóm | Nội dung |
|---|---|
| 1 | `parseSettingsJson` — file hỏng, JSON cụt, rác, **BOM ở đầu file**, mảng, `null` |
| 2 | `mainWindowHeight` — chọn chiều cao theo đóng/mở cài đặt, kẹp theo vùng làm việc |
| 2b | `clampWindowY` — giãn cửa sổ mà không thò khỏi màn hình, kể cả màn hình phụ có toạ độ âm |
| 3 | `reminderXY` — đặt cửa sổ nhắc theo vị trí đã chọn, có tính taskbar |
| 4 | `formatLogLine` / `shouldRotateLog` — định dạng và xoay vòng nhật ký |
| 5 | `notificationsAllowedFromState` — chỉ trạng thái 5 mới nhắc, ngoài dải → **fail-open** |

Mỗi lỗi thật đã sửa đều được để lại một test hồi quy. Ví dụ: `clampWindowY(328, 864, WA)`
phải bằng `176` — đúng con số của ca người dùng báo (cửa sổ ở giữa màn hình 1080, xổ cài đặt
ra thì nút *Lưu* rơi khỏi màn hình).

---

## Nghiệm trên app chạy thật

Unit test không chứng minh được "cửa sổ có hiện đúng chỗ không", "hình có động không", "nút
có bấm được không". Những thứ đó phải đo trên app đang chạy.

Cách làm: chạy Electron kèm cổng gỡ lỗi rồi điều khiển bằng **CDP** (Chrome DevTools
Protocol) qua `WebSocket` có sẵn của Node ≥ 22 — không cần thư viện nào:

```bash
npx electron . --user-data-dir=<hồ sơ riêng> --remote-debugging-port=9333
```

```js
// lấy danh sách trang, mở WebSocket tới trang cần đo, rồi Runtime.evaluate
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = list.find((t) => t.type === 'page' && /overlay\.html/.test(t.url));
```

Từ đó đo được **hình học thật**: `getBoundingClientRect()` theo thời gian, góc xoay lấy từ
`new DOMMatrix(getComputedStyle(el).transform)`, vị trí cửa sổ, khả năng cuộn…

**Muốn biết trạng thái thật của cửa sổ thì phải hỏi main process.** `document.visibilityState`
của một trang trong `BrowserWindow` đang ẩn **không đáng tin** — đã một lần cho kết quả sai
và suýt dẫn tới kết luận nhầm là có lỗi. Cách đúng là mở thêm cổng inspector cho main
process:

```bash
npx electron --inspect=9334 . --user-data-dir=<hồ sơ riêng>
```

```js
// Lưu ý: global scope của inspector KHÔNG có sẵn `require`
process.mainModule.require('electron').BrowserWindow.getAllWindows()
  .map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible() }));
```

`isVisible()` mới là sự thật.

**Luôn nghiệm lại trên bản đã cài**, không chỉ bản dev — `window.standup.getEnv().packaged`
xác nhận đúng là bản đóng gói.

---

## Những cái bẫy khi đo

Mỗi mục dưới đây từng cho một kết quả **sai** và tốn thời gian truy ngược:

**Cửa sổ lấy mẫu quá ngắn.** Động tác giãn cơ có đoạn "giữ" dài; lấy mẫu góc trong 1,2 giây
của một chu kỳ 3,6 giây rất dễ rơi trọn vào đoạn giữ → kết luận "hình không động". Phải lấy
mẫu **trọn một chu kỳ**.

**Chọn sai khung đỉnh.** Khi hình vừa xoay vừa dịch ngang, đo toạ độ tuyệt đối cho kết quả
lẫn lộn. Đo **tương đối** với một phần không xoay (ví dụ hai chân) để triệt tiêu phần dịch.

**Selector bắt nhầm phần tử.** `#ov-side line:nth-last-child(...)` từng bắt cánh tay tưởng
là chân. Dùng con trực tiếp (`#ov-side > line`) và kiểm tra lại phần tử bắt được.

**`document.visibilityState` với cửa sổ ẩn** — như trên.

**Đóng băng animation bằng `animationDelay` không đáng tin.** Cứ để nó chạy rồi lấy mẫu
liên tục thì chắc chắn hơn.

**Bản dev và bản đã cài dùng chung khoá chống chạy trùng** — quên `--user-data-dir` riêng
thì bản dev tự thoát và bạn ngồi đo bản cũ. Xem
[ghi chú kỹ thuật](ghi-chu-ky-thuat.md#bản-dev-tranh-chấp-với-bản-đã-cài).

Bài học chung: khi máy đo báo hỏng, **nghi ngờ máy đo trước**. Trong dự án này, số lần bài
kiểm sai nhiều hơn số lần app sai.

---

## Chưa test được

Nói thẳng ra để ai đọc mã cũng biết chỗ nào còn mỏng:

- **Nhiều màn hình** — máy phát triển chỉ có một màn hình. Logic dùng `getDisplayMatching` /
  `getDisplayNearestPoint` nên về nguyên tắc là đúng, nhưng chưa nghiệm thật. Ca đáng ngờ
  nhất: kéo cửa sổ sang màn hình phụ thấp hơn rồi mở cài đặt.
- **DPI đổi giữa chừng** — kéo cửa sổ qua màn hình có tỉ lệ khác. (DPI 125%/150% *cố định*
  thì đã đo bằng `--force-device-scale-factor`.)
- **Máy sạch** chưa từng cài Node/Electron — cần cho việc xác nhận tên trên toast banner.
- **Một giờ nghỉ trọn vẹn kết thúc tự nhiên** — mới test đường nhanh và bằng mô phỏng thời
  gian, chưa ngồi đợi đủ 5 phút thật.
