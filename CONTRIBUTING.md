# Đóng góp cho StandUp

Cảm ơn bạn đã ghé. Dự án này nhỏ và có quan điểm rõ ràng — đọc phần
[Triết lý](#triết-lý) trước khi làm tính năng lớn sẽ đỡ mất công cho cả hai bên.

- [Dựng môi trường](#dựng-môi-trường)
- [Triết lý](#triết-lý)
- [Quy ước mã nguồn](#quy-ước-mã-nguồn)
- [Test](#test)
- [Commit và pull request](#commit-và-pull-request)
- [Báo lỗi](#báo-lỗi)

---

## Dựng môi trường

Cần [Node.js](https://nodejs.org) ≥ 20 và Windows 10/11.

```bash
git clone https://github.com/tarasami/StandUp.git
cd StandUp
npm install
npm start
```

**Nếu bạn đã cài bản đóng gói trên cùng máy:** bản dev sẽ tự thoát khi mở, vì cả hai dùng
chung `%APPDATA%\standup` nên chung khoá chống chạy trùng. Chạy tách biệt bằng:

```bash
npx electron . --user-data-dir=.dev-profile
```

`.dev-profile/` đã có trong `.gitignore`.

Các lệnh khác:

| Lệnh | Việc |
|---|---|
| `npm test` | 242 unit test, Node thuần, chưa tới 1 giây |
| `npm run dist` | Đóng gói installer NSIS vào `dist/` |
| `npm run icon` | Vẽ lại `build/icon.ico` (7 kích thước) bằng code |

---

## Triết lý

Ba điều định hình mọi quyết định trong dự án. Nếu đề xuất của bạn đi ngược lại một trong ba,
hãy mở issue bàn trước khi viết mã.

**1. Không phiền là tính năng số một.** Notification fatigue là lý do số 1 khiến app cùng
loại bị gỡ. Mọi thứ làm app "nhắc mạnh hơn" đều phải cân với rủi ro người dùng tắt hẳn nó.
Khi phân vân, chọn phương án im lặng hơn — nhưng **không bao giờ im vĩnh viễn**: mọi cơ chế
hoãn đều phải *fail-open* và có đường thoát.

**2. Nhẹ và sạch.** `dependencies` đang rỗng và nên giữ như vậy. Icon vẽ bằng code, âm báo
tổng hợp bằng Web Audio, hình giãn cơ vẽ bằng SVG/CSS — không tệp ảnh, không tệp nhạc, không
thư viện UI. Thêm một phụ thuộc runtime cần lý do rất tốt.

**Không có mã kết nối mạng.** Không tài khoản, không đồng bộ, không đo đạc từ xa. PR thêm
bất cứ thứ gì gọi ra Internet sẽ bị từ chối trừ khi đó là tính năng người dùng chủ động bật
và có bàn trước.

**3. Logic nghiệp vụ nằm trong engine thuần.** `electron/engine.js` **không được**
`require('electron')`. Đó là điều kiện để test bằng mô phỏng thời gian. Xem
[docs/architecture.md](docs/architecture.md).

---

## Quy ước mã nguồn

Không có linter tự động — chỉ cần **viết giống mã xung quanh**.

- JavaScript thuần, không TypeScript, không bước build cho mã nguồn.
- 2 dấu cách thụt lề, nháy đơn, có dấu chấm phẩy.
- **Xuống dòng CRLF** — kho này dùng CRLF; đừng đổi hàng loạt.
- **Mã nguồn viết bằng tiếng Anh**: tên biến, tên hàm, bình luận, tên test — để người
  ngoài đọc được kho này.
- **Chuỗi người dùng nhìn thấy giữ tiếng Việt**: giao diện, câu nhắc, tên động tác
  giãn cơ, nhãn menu tray, và nội dung ghi vào `standup.log` (người dùng được hướng
  dẫn đọc file này khi báo lỗi). Đây là app cho người Việt; giao diện đa ngôn ngữ nằm
  trong lộ trình sau 1.0.

**Bình luận giải thích VÌ SAO, không phải LÀM GÌ.** Mã đã nói nó làm gì rồi. Cái đắt giá là
lý do — nhất là những chỗ trông kỳ quặc:

```js
// GOOD — saves a future reader from "cleaning up" a hard-won fix
// On Windows, setSize/setBounds is ignored for a resizable:false window → unlock briefly.
mainWin.setResizable(true);

// POINTLESS
// Set resizable to true
mainWin.setResizable(true);
```

Gặp một cái bẫy của Windows/Electron thì ghi lại vào
[docs/technical-notes.md](docs/technical-notes.md) — đó là phần tài liệu có giá trị nhất
của dự án.

Giọng của giao diện: thân thiện, xưng "bạn", không ra lệnh. Chưa có hệ thống đa ngôn ngữ
nên chuỗi hiển thị viết thẳng trong mã — mỗi file có một dòng ghi chú ở đầu nhắc lại
ranh giới tiếng Anh / tiếng Việt này.

---

## Test

**Sửa engine thì phải có test.** `test/engine.test.js` chạy bằng Node thuần và mô phỏng thời
gian, nên không có cớ gì để bỏ qua.

**Sửa một lỗi thì để lại một test hồi quy** — tốt nhất là dùng đúng con số của ca hỏng thật.

**Logic tính toán mới nên đặt trong `electron/main-utils.js`** thay vì `main.js`, để test
được. Mọi lỗi thật của dự án đến nay đều nằm ở tầng Electron, không phải engine.

**Sửa giao diện hoặc hành vi cửa sổ thì nghiệm trên app chạy thật**, đừng chỉ dựa vào unit
test. [docs/testing.md](docs/testing.md) mô tả cách điều khiển app đang chạy bằng CDP để
đo hình học thật (vị trí cửa sổ, góc xoay, khả năng cuộn), kèm danh sách những cái bẫy đo
đạc đã gặp.

Chạy `npm test` trước khi mở PR. CI cũng chạy nó trên mọi push.

---

## Commit và pull request

**Thông điệp commit bằng tiếng Việt**, một dòng đầu ngắn gọn ở thể mệnh lệnh:

```
Sửa cửa sổ Cài đặt bị tràn khỏi màn hình, nuốt mất nút Lưu
```

Phần thân (nếu có) nên trả lời: **triệu chứng gì, nguyên nhân ở đâu, đã nghiệm thế nào**.
Kèm số đo cụ thể nếu có — chúng đắt giá hơn tính từ rất nhiều.

Trước khi mở PR, tự soát:

- [ ] `npm test` đạt
- [ ] Sửa engine → đã thêm test
- [ ] Sửa lỗi → đã có test hồi quy
- [ ] Sửa UI/cửa sổ → đã chạy thử app thật, mô tả cách nghiệm trong PR
- [ ] Thêm ô cài đặt → đã chỉnh `HEIGHTS.full` trong `main.js` và kiểm nút *Lưu* còn thấy
- [ ] Không thêm phụ thuộc runtime (hoặc có lý do rõ trong PR)
- [ ] Gặp bẫy mới → đã ghi vào `docs/technical-notes.md`

Tính năng lớn thì **mở issue bàn trước** — đỡ mất công viết mã rồi bị từ chối vì lệch hướng
sản phẩm.

---

## Báo lỗi

Dùng mẫu [báo lỗi](https://github.com/tarasami/StandUp/issues/new/choose). Xin kèm:

- Phiên bản Windows và tỉ lệ hiển thị (100% / 125% / 150%), số màn hình.
- Bản đã cài hay chạy từ mã nguồn.
- **Vài dòng cuối của `%APPDATA%\standup\standup.log`** (menu tray → *Mở thư mục nhật ký*).
  Nhật ký chỉ ghi trạng thái và cài đặt của app — không có tên cửa sổ, không có nội dung
  bạn gõ. Vẫn nên đọc lướt trước khi dán.

Lỗi **bảo mật** thì đừng mở issue công khai — xem [SECURITY.md](SECURITY.md).
