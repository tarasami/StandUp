# StandUp — Kế hoạch sản phẩm

Ứng dụng nhắc nhở vận động cho người làm việc máy tính: phát thông báo nhắc đứng dậy đi lại/giãn cơ sau mỗi khoảng thời gian ngồi làm việc do người dùng cài đặt.

---

## 1. Bối cảnh & Vấn đề

Người làm việc văn phòng, lập trình viên, designer… thường ngồi liên tục 2–4 giờ mà không đứng dậy. Hậu quả: đau lưng, mỏi cổ vai gáy, mỏi mắt, giảm tuần hoàn máu, tăng nguy cơ bệnh chuyển hóa. Ai cũng **biết** cần đứng dậy thường xuyên, nhưng khi tập trung làm việc thì **quên** — đây là bài toán về thói quen, không phải về kiến thức.

**Insight quan trọng nhất:** Phần khó của sản phẩm này không phải là cái đồng hồ đếm giờ — mà là làm sao nhắc nhở **không gây phiền** đến mức người dùng tắt app. Notification fatigue là nguyên nhân số 1 khiến các app cùng loại bị gỡ. Mọi quyết định thiết kế phải xoay quanh: *nhắc đúng lúc, đúng cách, và biết im lặng khi cần*.

## 2. Đối tượng người dùng

| Persona | Đặc điểm | Nhu cầu chính |
|---|---|---|
| **Dev/Designer** (25–40) | Ngồi 8–10h/ngày, hay vào "flow", ghét bị ngắt quãng | Nhắc nhẹ nhàng, không phá vỡ tập trung, hoãn được |
| **Nhân viên văn phòng** (25–45) | Nhiều cuộc họp online, dùng máy công ty | Không hiện thông báo khi đang họp/chia sẻ màn hình |
| **Người có vấn đề sức khỏe** (30–55) | Đã đau lưng/cổ, có động lực cao | Nhắc "cứng" hơn, gợi ý bài giãn cơ cụ thể, thống kê |

**Nền tảng:** Desktop (Windows trước) — vì lời nhắc phải xuất hiện **ngay nơi người dùng đang làm việc**. App mobile cho bài toán này là sai form factor: điện thoại không biết bạn đang ngồi trước máy tính, và thông báo điện thoại dễ bị bỏ qua khi đang gõ phím.

## 3. Phân tích cạnh tranh

| Sản phẩm | Điểm mạnh | Điểm yếu |
|---|---|---|
| **Stretchly** (open source, Electron) | Miễn phí, đa nền tảng, micro-break + long break | Nặng (~200MB RAM), UI cũ, không phát hiện họp |
| **Workrave** | Lâu đời, thống kê chi tiết | UI rất cũ, cấu hình phức tạp |
| **Big Stretch Reminder** | Nhẹ, đơn giản | Windows-only, không còn phát triển, không thông minh |
| **EyeLeo** | Bài tập mắt sinh động | Ngừng phát triển, không tùy biến sâu |

**Khe hở thị trường / Điểm khác biệt của StandUp:**
1. **Nhắc thông minh** — biết khi nào bạn rời máy (idle detection) để tự reset chu kỳ; biết khi nào bạn đang họp/thuyết trình/fullscreen để im lặng.
2. **Nhẹ & sạch** — chạy nền < 30MB RAM, không thu thập dữ liệu, offline hoàn toàn.
3. **Song ngữ Việt–Anh** — chưa app nào cùng loại làm tốt tiếng Việt.
4. **Onboarding 30 giây** — cài xong, chọn 1 con số, chạy. Không bắt tạo tài khoản.

## 4. Phạm vi tính năng

### MVP (v1.0) — phải có

| # | Tính năng | Mô tả |
|---|---|---|
| 1 | **Bộ đếm chu kỳ ngồi** | Mặc định 45 phút; preset 30/45/60 + tùy chỉnh tự do |
| 2 | **Thông báo nhắc vận động** | Toast notification hệ thống kèm 3 hành động: **[Nghỉ ngay]** · **[Hoãn 5']** · **[Bỏ qua]** |
| 3 | **Chế độ nghỉ** | Đếm ngược thời gian nghỉ (mặc định 5'), kết thúc → tự bắt đầu chu kỳ mới |
| 4 | **Idle detection** | Rời máy quá N phút (mặc định 5') → coi như đã nghỉ, tự reset chu kỳ. Đây là tính năng "thông minh" tối thiểu bắt buộc có từ MVP — thiếu nó app sẽ nhắc bạn đứng dậy ngay khi bạn vừa đi ăn trưa về |
| 5 | **Tray icon** | Hiện số phút còn lại; menu: Tạm dừng 1h / Tạm dừng đến hết ngày / Nghỉ ngay / Cài đặt / Thoát |
| 6 | **Cài đặt** | Khoảng nhắc, thời lượng nghỉ, âm thanh bật/tắt, khởi động cùng Windows, ngôn ngữ |
| 7 | **Onboarding 1 màn hình** | Chọn khoảng nhắc → xong. Dưới 30 giây |
| 8 | **Installer** | File cài .msi/.exe, tự cập nhật (hoặc tối thiểu: thông báo có bản mới) |

### v1.1 — nên có (ngay sau MVP)

- **Overlay nghỉ**: cửa sổ mờ toàn màn hình (có thể bỏ qua) với 1 gợi ý giãn cơ ngắn kèm hình minh họa — tăng mạnh tỉ lệ thực sự đứng dậy.
- **Chế độ Không làm phiền tự động**: phát hiện fullscreen/đang thuyết trình/đang gọi video → hoãn nhắc đến khi kết thúc.
- **Lịch làm việc**: chỉ nhắc trong khung giờ và ngày cấu hình (mặc định 8h–18h, T2–T6).
- **Thống kê ngày/tuần**: số lần nghỉ, chuỗi ngồi dài nhất, tỉ lệ tuân thủ.

### v2.0 — cân nhắc sau

- Chuỗi ngày (streak) & huy hiệu nhẹ nhàng — gamification mức tối thiểu, không point/leaderboard.
- Thư viện bài giãn cơ 1–3 phút (cổ, vai, lưng, cổ tay) dạng animation.
- Nhắc kèm: uống nước, quy tắc mắt 20-20-20 (tắt mặc định — tránh biến app thành máy spam).
- macOS & Linux.
- Đồng bộ cài đặt qua file/cloud (tùy chọn).

**Kỷ luật phạm vi:** mọi đề xuất tính năng mới phải trả lời được "nó có làm tăng tỉ lệ *thực sự đứng dậy* không?" — nếu không, để sau.

## 5. Luồng người dùng chính

**Luồng 1 — Lần đầu sử dụng:**
Cài đặt → mở app → 1 màn hình chọn khoảng nhắc (mặc định 45') + checkbox "Khởi động cùng Windows" (bật sẵn) → **[Bắt đầu]** → app thu vào tray, bắt đầu đếm.

**Luồng 2 — Chu kỳ nhắc (luồng lõi, lặp lại cả ngày):**
```
Đếm 45' ──► Toast: "Bạn đã ngồi 45 phút. Đứng dậy đi lại chút nhé! 🚶"
                │
    ┌───────────┼─────────────┐
[Nghỉ ngay]  [Hoãn 5']    [Bỏ qua]
    │           │             │
Đếm ngược    5' sau       Chu kỳ mới
nghỉ 5'      nhắc lại     bắt đầu ngay
    │
Hết giờ nghỉ → âm báo nhẹ → chu kỳ mới
```

**Luồng 3 — Rời máy (không cần thao tác):**
Người dùng đi họp/ăn trưa → không có input chuột/phím > 5' → app tự coi là đã nghỉ → quay lại máy → chu kỳ mới tự bắt đầu. *Người dùng không bao giờ phải "khai báo" mình đã nghỉ.*

**Luồng 4 — Tạm dừng chủ động:**
Click tray icon → "Tạm dừng 1 giờ" (deadline gấp, đang họp dài) → hết 1h tự chạy lại.

## 6. Yêu cầu phi chức năng

- **Nhẹ**: < 30MB RAM khi chạy nền, CPU ~0% khi idle, khởi động < 2 giây.
- **Đúng giờ tin cậy**: dùng timestamp tuyệt đối, không dùng bộ đếm tương đối — máy sleep/hibernate xong tỉnh dậy phải tính lại đúng (ngủ máy > 5' = đã nghỉ).
- **Riêng tư**: không thu thập dữ liệu, không cần mạng, không tài khoản. Dữ liệu thống kê lưu local.
- **Ổn định**: chạy nền nhiều ngày không crash, crash-free ≥ 99.5%.

## 7. Lựa chọn công nghệ (khuyến nghị)

| Phương án | Ưu | Nhược | Phù hợp khi |
|---|---|---|---|
| **Tauri 2** ⭐ đề xuất | Rất nhẹ (~5–15MB RAM nền), UI bằng web (HTML/JS), đa nền tảng sau này, installer + auto-update có sẵn | Cần chút Rust cho phần native (ít) | Muốn nhẹ + có kỹ năng web |
| **.NET 8 (WPF/WinUI)** | Native Windows, API tray/toast/idle đầy đủ, dễ với dân C# | Khó lên macOS/Linux sau này | Team thuần C#, chỉ cần Windows |
| **Electron** | Dev nhanh nhất nếu rành JS | Nặng 150–250MB RAM — mâu thuẫn trực tiếp với định vị "nhẹ" | Prototype nhanh, chấp nhận nặng |

**Đề xuất: Tauri 2** — vì "nhẹ" là điểm khác biệt cạnh tranh đã tuyên bố ở mục 3, và giữ đường mở rộng đa nền tảng cho v2.

> **Quyết định 06/08/2026 (Sprint 0):** Máy dev chưa có Rust + MSVC Build Tools (~3–4GB cài đặt), nhưng có sẵn Node 22. Để không chặn sprint, PoC được dựng bằng **Electron** (phương án "prototype nhanh" trong bảng trên) với kiến trúc tách lớp: engine (state machine thuần JS) + UI (HTML/CSS/JS) độc lập hoàn toàn với shell — cả hai tái sử dụng 1:1 khi chuyển sang Tauri trước bản 1.0 phát hành. Điều kiện chuyển: cài Rust toolchain (lệnh trong README).

Tính khả thi kỹ thuật trên Windows (đã có API sẵn, rủi ro thấp):
- Idle detection: `GetLastInputInfo` (Win32 API).
- Phát hiện fullscreen/thuyết trình: `SHQueryUserNotificationState`.
- Toast notification kèm nút hành động: Windows Notification API (Tauri plugin có sẵn).
- Khởi động cùng Windows: registry `Run` key hoặc Startup folder.

## 8. Lộ trình (1 dev full-time)

| Giai đoạn | Thời gian | Nội dung | Kết quả |
|---|---|---|---|
| **Sprint 0** ✅ | Tuần 1 | Dựng khung, tray icon, vòng lặp timer, cửa sổ nhắc có nút hành động, idle detection | Xong — 3 rủi ro kỹ thuật lớn nhất đều giải được, vá thêm lỗi đồng hồ chỉnh lùi |
| **Sprint 1–2** ✅ | Tuần 2–3 | Đủ 8 hạng mục MVP, installer, autostart | Xong — onboarding, khởi động cùng Windows, 12 câu nhắc xoay vòng, âm báo, installer NSIS. 110 unit test |
| **Sprint 3** | Tuần 4 | Beta nội bộ 5–10 người dùng thật, sửa lỗi, tinh chỉnh lời nhắc & âm thanh | Bản 1.0 phát hành |
| **Sprint 4–5** | Tuần 5–6 | v1.1: overlay nghỉ, DND tự động, lịch làm việc, thống kê | Bản 1.1 |
| Sau đó | — | Đánh giá metrics → quyết định v2 | — |

**Tổng: ~4 tuần đến 1.0, ~6 tuần đến 1.1.**

## 9. Chỉ số thành công

| Chỉ số | Mục tiêu | Ý nghĩa |
|---|---|---|
| **Break compliance** — % lời nhắc dẫn đến nghỉ thật (bấm Nghỉ ngay hoặc idle ngay sau nhắc) | ≥ 40% | Chỉ số Bắc Đẩu — đo đúng giá trị cốt lõi |
| Tỉ lệ Bỏ qua + Hoãn | < 40% | Proxy cho độ phiền; cao quá = nhắc sai lúc |
| Retention D7 / D30 (app còn chạy trong tray) | ≥ 40% / ≥ 25% | App tiện ích nền sống hay chết ở retention |
| Kích hoạt: qua onboarding & còn chạy sau 3 ngày | ≥ 70% | Đo độ mượt của first-run |
| Crash-free sessions | ≥ 99.5% | Nền tảng của mọi thứ khác |

*Lưu ý đo lường:* app định vị "không thu thập dữ liệu" → metrics chỉ tính local + màn hình opt-in chia sẻ số liệu ẩn danh (tắt mặc định). Giai đoạn beta dùng phỏng vấn trực tiếp thay cho telemetry.

## 10. Rủi ro & Giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| **Notification fatigue** — người dùng tắt app sau 1 tuần | Cao | Idle detection + DND tự động (nhắc đúng lúc); đa dạng câu chữ lời nhắc; không bao giờ nhắc dồn dập; mặc định nhẹ nhàng, ai muốn "cứng" tự bật overlay |
| Windows Focus Assist / cài đặt hệ thống chặn toast | Trung | Phát hiện toast bị chặn → fallback sang cửa sổ nhắc riêng của app; hướng dẫn 1 lần khi onboarding |
| Máy sleep/hibernate làm timer sai | Trung | Tính theo timestamp tuyệt đối; kiểm thử kịch bản sleep/resume ngay Sprint 0 |
| App "vô hình" trong tray → bị quên, bị gỡ | Trung | Icon tray hiện số phút còn lại; (v1.1) tóm tắt tuần tạo cảm giác giá trị |
| Phạm vi phình to (nhắc nước, mắt, thiền…) | Trung | Câu hỏi gác cổng ở mục 4; mọi tính năng phụ tắt mặc định |
| Tự cài lại interval quá dài (3–4h) làm mất giá trị | Thấp | Giới hạn mềm + nudge khi đặt > 90' ("Chuyên gia khuyến nghị 30–60 phút") |

## 11. Việc cần làm ngay (tuần này)

1. Chốt stack (đề xuất: Tauri 2) — quyết định duy nhất chặn đường.
2. Sprint 0: dựng khung project, PoC toast + idle detection + timer qua sleep/resume.
3. Viết 10–15 biến thể câu nhắc (tiếng Việt + Anh) — giọng thân thiện, không ra lệnh, không phán xét.
4. Phác wireframe 3 màn hình: onboarding, settings, toast/overlay.
5. Tuyển 5–10 người dùng beta (đồng nghiệp làm việc máy tính ≥ 6h/ngày).
