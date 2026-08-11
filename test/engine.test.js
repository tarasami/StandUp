// Unit test cho engine — chạy: npm test
// Mô phỏng tick từng giây như app thật; các bước nhảy thời gian lớn
// chỉ dùng để kiểm tra chính chức năng phát hiện sleep/hibernate và chỉnh đồng hồ.
const assert = require('node:assert');
const {
  Engine, clampSettings, DEFAULT_SETTINGS, REMIND_MESSAGES, BREAK_OVER_MESSAGES,
} = require('../electron/engine');

// Mặc định test: tắt âm để đếm effect cho gọn; các test âm thanh bật riêng.
const S = { intervalMins: 45, breakMins: 5, idleMins: 5, sound: false, autoStart: true, onboarded: true };
let t = 1_750_000_000_000; // mốc epoch bất kỳ
let passed = 0;

function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

// Tick từng giây, trả về mọi effect gom được.
function run(e, seconds, idle = 0) {
  const fx = [];
  for (let i = 0; i < seconds; i++) fx.push(...e.tick((t += 1000), idle));
  return fx;
}
const has = (fx, type) => fx.some((x) => x.type === type);
const count = (fx, type) => fx.filter((x) => x.type === type).length;
const fresh = (s = S) => new Engine(s, t);

console.log('1. Chu kỳ làm việc → nhắc nhở');
const e = fresh();
check('khởi động ở trạng thái working', e.phase === 'working');
let fx = run(e, 44 * 60);
check('44 phút: chưa nhắc', e.phase === 'working' && fx.length === 0);
fx = run(e, 61);
check('sau 45 phút: chuyển sang reminding', e.phase === 'reminding');
check('mở cửa sổ nhắc', has(fx, 'openReminder'));
check('bắn notification', has(fx, 'notify'));
check('chỉ nhắc ĐÚNG MỘT LẦN, không spam', count(fx, 'openReminder') === 1);
fx = run(e, 120);
check('đứng yên ở reminding, không nhắc lại chồng chất', count(fx, 'openReminder') === 0);

console.log('2. Nghỉ → hết giờ nghỉ → chu kỳ mới');
e.takeBreak(t);
check('bấm Nghỉ ngay → breaking', e.phase === 'breaking');
fx = run(e, 5 * 60 + 1);
check('hết 5 phút nghỉ → working trở lại', e.phase === 'working');
check('đóng cửa sổ nhắc + báo nghỉ xong', has(fx, 'closeReminder') && has(fx, 'notify'));
const st = e.status(t, 0);
check('chu kỳ mới đếm từ ~45 phút', st.remainingSecs > 44 * 60 && st.remainingSecs <= 45 * 60);

console.log('3. Idle detection — rời máy là coi như đã nghỉ');
fx = run(e, 1, 5 * 60);
check('idle ≥ ngưỡng → chuyển sang idle', e.phase === 'idle');
run(e, 10, 5 * 60 + 5);
check('vẫn idle khi còn rời máy', e.phase === 'idle');
fx = run(e, 1, 1);
check('quay lại máy → chu kỳ mới tự bắt đầu', e.phase === 'working');
check('không notification khi quay lại (im lặng)', !has(fx, 'notify'));

console.log('3b. Biên chính xác của ngưỡng idle');
let b = fresh();
run(b, 5, 4 * 60 + 59);
check('idle 4:59 (dưới ngưỡng 5:00): vẫn working', b.phase === 'working');
run(b, 1, 5 * 60);
check('idle đúng 5:00: chuyển idle', b.phase === 'idle');
b = fresh();
run(b, 1, 5 * 60);
run(b, 1, 4); // BACK_ACTIVE_SECS = 3
check('idle tụt về 4s: chưa coi là quay lại', b.phase === 'idle');
run(b, 1, 3);
check('idle tụt về 3s: đã quay lại → working', b.phase === 'working');

console.log('3c. Rời máy NGAY SAU khi được nhắc (không bấm nút nào)');
b = fresh();
run(b, 45 * 60 + 1);
check('đang ở reminding', b.phase === 'reminding');
fx = run(b, 1, 5 * 60);
check('đứng dậy bỏ đi → tự ghi nhận đã nghỉ', b.phase === 'idle');
check('cửa sổ nhắc tự đóng, không để treo trên màn hình', has(fx, 'closeReminder'));

console.log('3d. Rời máy trong lúc đang nghỉ');
b = fresh();
b.triggerReminder();
b.takeBreak(t);
fx = run(b, 5 * 60 + 1, 4 * 60); // đi vắng suốt giờ nghỉ
check('giờ nghỉ vẫn chạy hết dù người dùng đi vắng', b.phase === 'working');
check('vẫn báo hết giờ nghỉ', has(fx, 'notify'));

console.log('4. Sleep/hibernate — khoảng trống thời gian lớn');
run(e, 5, 0);
e.tick((t += 30 * 60_000), 0);
check('sau sleep 30 phút → chu kỳ mới, không nhắc', e.phase === 'working');
check('deadline tính lại từ lúc tỉnh dậy', e.status(t, 0).remainingSecs > 44 * 60);

b = fresh();
run(b, 45 * 60 + 1);
fx = b.tick((t += 60 * 60_000), 0); // ngủ 1 tiếng khi đang hiện cửa sổ nhắc
check('sleep lúc đang nhắc → chu kỳ mới', b.phase === 'working');
check('cửa sổ nhắc được dọn, không treo lại sau khi tỉnh', has(fx, 'closeReminder'));

b = fresh();
b.triggerReminder();
b.takeBreak(t);
fx = b.tick((t += 60 * 60_000), 0);
check('sleep lúc đang nghỉ → chu kỳ mới + dọn cửa sổ', b.phase === 'working' && has(fx, 'closeReminder'));

b = fresh();
b.pause(t, null);
b.tick((t += 60 * 60_000), 0);
check('sleep lúc đang tạm dừng: KHÔNG tự bật lại', b.phase === 'paused');

b = fresh();
b.tick((t += 80 * 1000), 0); // gap 80s < SLEEP_GAP_SECS 90
check('gap ngắn (80s, treo máy nhẹ) không bị nhầm là sleep', b.phase === 'working');

console.log('4b. Đồng hồ hệ thống bị chỉnh LÙI (NTP sync / đổi múi giờ)');
b = fresh();
run(b, 60);
t -= 2 * 3600_000; // lùi 2 tiếng
b.tick(t, 0);
const backSt = b.status(t, 0);
check('không im lặng vô thời hạn: deadline kéo về ≤ 1 chu kỳ', backSt.remainingSecs <= 45 * 60);
check('vẫn đếm ngược bình thường', backSt.remainingSecs > 0);
run(b, 45 * 60 + 1);
check('vẫn nhắc được sau khi đồng hồ bị chỉnh lùi', b.phase === 'reminding');

b = fresh();
b.pause(t, 60);
t -= 5 * 3600_000; // lùi 5 tiếng khi đang tạm dừng
b.tick(t, 0);
check('tạm dừng có hẹn giờ không bị kẹt vĩnh viễn', b.status(t, 0).remainingSecs <= 60 * 60);

console.log('5. Hoãn & bỏ qua');
e.triggerReminder();
fx = e.snooze(t);
check('hoãn → working, đóng cửa sổ', e.phase === 'working' && has(fx, 'closeReminder'));
check('hoãn đúng 5 phút', e.status(t, 0).remainingSecs === 5 * 60);
run(e, 5 * 60 + 1);
check('hết 5 phút hoãn → nhắc lại', e.phase === 'reminding');
e.snooze(t);
run(e, 5 * 60 + 1);
check('hoãn nhiều lần liên tiếp vẫn hoạt động', e.phase === 'reminding');
fx = e.skip(t);
check('bỏ qua → chu kỳ mới đầy đủ', e.phase === 'working' && e.status(t, 0).remainingSecs === 45 * 60);

console.log('5b. Hành động sai ngữ cảnh không làm hỏng trạng thái');
b = fresh();
check('bấm Nghỉ khi đang working: bị bỏ qua', b.takeBreak(t).length === 0 && b.phase === 'working');
check('hoãn khi đang working: bị bỏ qua', b.snooze(t).length === 0 && b.phase === 'working');
check('bỏ qua khi đang working: bị bỏ qua', b.skip(t).length === 0 && b.phase === 'working');
b.pause(t, null);
check('Tiếp tục khi đang paused → working', b.resume(t) && b.phase === 'working' || b.phase === 'working');
check('Tiếp tục khi đang working: vô hại', (b.resume(t), b.phase === 'working'));

console.log('5c. Nghỉ ngay từ tray ở mọi trạng thái');
for (const setup of ['working', 'idle', 'paused']) {
  b = fresh();
  if (setup === 'idle') run(b, 1, 5 * 60);
  if (setup === 'paused') b.pause(t, null);
  fx = b.breakNow(t);
  check(`"Nghỉ ngay" từ ${setup} → breaking + mở cửa sổ`, b.phase === 'breaking' && has(fx, 'openReminder'));
}

console.log('6. Tạm dừng');
b = fresh();
b.pause(t, 60);
check('tạm dừng 60 phút → paused', b.phase === 'paused');
run(b, 30, 0);
check('trong thời gian tạm dừng: giữ nguyên paused', b.phase === 'paused');
run(b, 5, 10 * 60);
check('idle khi đang tạm dừng: vẫn paused, không nhảy sang idle', b.phase === 'paused');
b.tick((t += 61 * 60_000), 0);
check('hết giờ tạm dừng → tự chạy lại', b.phase === 'working');
b.pause(t, null);
b.tick((t += 8 * 3600_000), 0);
check('tạm dừng vô thời hạn: không tự chạy lại (kể cả sau 8 giờ)', b.phase === 'paused');
b.resume(t);
check('bấm Tiếp tục → chu kỳ mới', b.phase === 'working');

b = fresh();
b.triggerReminder();
fx = b.pause(t, 60);
check('tạm dừng lúc đang nhắc → dọn cửa sổ nhắc', has(fx, 'closeReminder') && b.phase === 'paused');
b = fresh();
b.triggerReminder();
b.takeBreak(t);
fx = b.pause(t, 60);
check('tạm dừng lúc đang nghỉ → dọn cửa sổ nhắc', has(fx, 'closeReminder') && b.phase === 'paused');
// Hồi quy: "Thử nhắc nhở" từng xoá pauseUntil, nên thử nhắc lúc đang tạm dừng
// là mất luôn trạng thái tạm dừng — app âm thầm chạy lại sau lưng người dùng.
b = fresh();
b.pause(t, null);
b.triggerReminder();
check('thử nhắc lúc đang tạm dừng: cửa sổ nhắc vẫn hiện', b.phase === 'reminding');
b.skip(t);
check('bỏ qua lời nhắc thử → QUAY LẠI tạm dừng, không tự chạy tiếp', b.phase === 'paused');
run(b, 5 * 60);
check('vẫn nằm im ở tạm dừng vô thời hạn sau 5 phút', b.phase === 'paused');
b = fresh();
b.pause(t, 60);
b.triggerReminder();
b.skip(t);
check('tạm dừng có hẹn giờ cũng được trả lại nguyên vẹn',
  b.phase === 'paused' && b.status(t, 0).remainingSecs > 59 * 60);
run(b, 60 * 60 + 1);
check('hết hạn tạm dừng thì tự chạy lại bình thường', b.phase === 'working');
// Ngược lại: hưởng ứng lời nhắc thử là chủ động, tạm dừng coi như bỏ.
b = fresh();
b.pause(t, null);
b.triggerReminder();
b.takeBreak(t);
check('bấm Nghỉ ngay ở lời nhắc thử → nghỉ thật, bỏ tạm dừng', b.phase === 'breaking');
run(b, 5 * 60 + 1);
check('nghỉ xong về làm việc, KHÔNG quay lại tạm dừng', b.phase === 'working');
b = fresh();
b.pause(t, null);
b.triggerReminder();
b.snooze(t);
check('bấm Hoãn ở lời nhắc thử → hẹn lại 5 phút, bỏ tạm dừng', b.phase === 'working');
run(b, 5 * 60 + 1);
check('hoãn xong nhắc lại đúng hẹn', b.phase === 'reminding');
// Đường đi bình thường (không tạm dừng) không được đổi hành vi.
b = fresh();
b.triggerReminder();
b.skip(t);
check('không tạm dừng: bỏ qua vẫn bắt đầu chu kỳ mới như cũ',
  b.phase === 'working' && b.status(t, 0).remainingSecs === 45 * 60);

console.log('7. Đổi cài đặt giữa chừng');
b = fresh();
run(b, 10 * 60);
b.updateSettings(t, { intervalMins: 30, breakMins: 5, idleMins: 5 });
check('rút interval 45→30: deadline co lại ngay', b.status(t, 0).remainingSecs <= 30 * 60);
b = fresh();
run(b, 10 * 60);
b.updateSettings(t, { intervalMins: 60, breakMins: 5, idleMins: 5 });
check('nới interval 45→60: chu kỳ đang chạy không bị kéo dài đột ngột',
  b.status(t, 0).remainingSecs <= 35 * 60);
run(b, 35 * 60 + 1);
check('chu kỳ hiện tại kết thúc bình thường', b.phase === 'reminding');
b.skip(t);
check('chu kỳ SAU mới dùng interval 60 phút', b.status(t, 0).remainingSecs === 60 * 60);
b = fresh();
b.updateSettings(t, { intervalMins: 45, breakMins: 10, idleMins: 5 });
b.triggerReminder();
b.takeBreak(t);
check('đổi thời lượng nghỉ 5→10 có hiệu lực ngay lần nghỉ kế', b.status(t, 0).remainingSecs === 10 * 60);
// Hồi quy: updateSettings từng chỉ kẹp deadline ở nhánh WORKING, nên rút ngắn
// thời gian nghỉ lúc ĐANG nghỉ thì lượt nghỉ hiện tại vẫn chạy theo mốc cũ dài hơn.
b = fresh();
b.triggerReminder();
b.takeBreak(t);
run(b, 60);
b.updateSettings(t, { ...S, breakMins: 2 });
check('đang nghỉ mà rút 5→2 phút: mốc nghỉ co lại ngay', b.status(t, 0).remainingSecs <= 2 * 60);
run(b, 2 * 60 + 1);
check('lượt nghỉ vừa rút ngắn kết thúc đúng hạn', b.phase === 'working');
b = fresh();
b.triggerReminder();
b.takeBreak(t);
run(b, 60);
b.updateSettings(t, { ...S, breakMins: 30 });
check('đang nghỉ mà nới 5→30 phút: lượt nghỉ đang chạy không bị kéo dài',
  b.status(t, 0).remainingSecs <= 4 * 60);

console.log('8. clampSettings — chống dữ liệu rác từ UI và file settings.json');
const c = clampSettings;
const kept = c({ intervalMins: 30, breakMins: 3, idleMins: 2 });
check('giá trị hợp lệ giữ nguyên',
  kept.intervalMins === 30 && kept.breakMins === 3 && kept.idleMins === 2);
check('interval quá nhỏ (0) → kẹp lên 5', c({ intervalMins: 0 }).intervalMins === 5);
check('interval âm → kẹp lên 5', c({ intervalMins: -99 }).intervalMins === 5);
check('interval quá lớn (9999) → kẹp xuống 240', c({ intervalMins: 9999 }).intervalMins === 240);
check('chuỗi rỗng → kẹp về biên dưới', c({ intervalMins: '' }).intervalMins === 5);
check('chữ cái → về mặc định 45', c({ intervalMins: 'abc' }).intervalMins === 45);
check('null → mặc định', c({ intervalMins: null }).intervalMins === 5);
check('undefined → mặc định 45', c({}).intervalMins === 45);
check('object rỗng/không có gì → toàn mặc định',
  JSON.stringify(c(undefined)) === JSON.stringify(DEFAULT_SETTINGS));
check('file JSON hỏng (null) → toàn mặc định',
  JSON.stringify(c(null)) === JSON.stringify(DEFAULT_SETTINGS));
check('số thập phân được làm tròn', c({ intervalMins: 30.7 }).intervalMins === 31);
check('Infinity → mặc định', c({ intervalMins: Infinity }).intervalMins === 45);
check('NaN → mặc định', c({ intervalMins: NaN }).intervalMins === 45);
check('breakMins kẹp trong 1..60', c({ breakMins: 999 }).breakMins === 60 && c({ breakMins: 0 }).breakMins === 1);
check('idleMins kẹp trong 1..60', c({ idleMins: 999 }).idleMins === 60 && c({ idleMins: 0 }).idleMins === 1);
// Cài đặt sau khi làm sạch phải luôn dùng được cho Engine
const clamped = c({ intervalMins: '', breakMins: 'x', idleMins: -5 });
b = new Engine(clamped, t);
run(b, clamped.intervalMins * 60 + 1);
check('Engine chạy đúng với cài đặt vừa được làm sạch', b.phase === 'reminding');

console.log('8b. Cài đặt bật/tắt (bool) — khởi động cùng Windows, âm thanh, onboarding');
check('mặc định: âm bật, autoStart bật, CHƯA onboarding',
  DEFAULT_SETTINGS.sound === true && DEFAULT_SETTINGS.autoStart === true
  && DEFAULT_SETTINGS.onboarded === false);
check('bool hợp lệ giữ nguyên', c({ sound: false }).sound === false && c({ autoStart: false }).autoStart === false);
check('chuỗi "false" KHÔNG bị hiểu nhầm thành true → về mặc định', c({ sound: 'false' }).sound === true);
check('số 0 không phải bool → về mặc định', c({ sound: 0 }).sound === true);
check('null → về mặc định', c({ onboarded: null }).onboarded === false);
check('onboarded=true được giữ (không bắt xem lại onboarding)', c({ onboarded: true }).onboarded === true);
check('file cũ (thiếu trường mới) vẫn nạp được, điền mặc định',
  c({ intervalMins: 30, breakMins: 5, idleMins: 5 }).sound === true);

console.log('8c. Âm thanh — chỉ phát khi người dùng bật');
b = new Engine({ ...S, sound: true }, t);
fx = run(b, 45 * 60 + 1);
check('bật âm: có effect sound khi nhắc', has(fx, 'sound'));
check('đúng loại âm "remind"', fx.find((x) => x.type === 'sound').kind === 'remind');
b.takeBreak(t);
fx = run(b, 5 * 60 + 1);
check('bật âm: có âm báo hết giờ nghỉ', has(fx, 'sound'));
check('đúng loại âm "breakOver"', fx.find((x) => x.type === 'sound').kind === 'breakOver');
b = new Engine({ ...S, sound: false }, t);
fx = run(b, 45 * 60 + 1);
check('tắt âm: KHÔNG có effect sound khi nhắc', !has(fx, 'sound'));
check('tắt âm vẫn nhắc bình thường', has(fx, 'openReminder') && has(fx, 'notify'));
b.takeBreak(t);
fx = run(b, 5 * 60 + 1);
check('tắt âm: không âm báo hết giờ nghỉ', !has(fx, 'sound'));

console.log('8d. Đa dạng lời nhắc — không lặp câu, thay đúng số phút');
check(`có đủ bộ câu nhắc (${REMIND_MESSAGES.length} câu)`, REMIND_MESSAGES.length >= 10);
check(`có bộ câu báo hết giờ nghỉ (${BREAK_OVER_MESSAGES.length} câu)`, BREAK_OVER_MESSAGES.length >= 3);
check('mọi câu nhắc đều có chỗ chèn số phút',
  REMIND_MESSAGES.every((m) => m.body.includes('{mins}')));
check('không câu nhắc nào trùng nhau',
  new Set(REMIND_MESSAGES.map((m) => m.title)).size === REMIND_MESSAGES.length);
b = fresh();
const titles = [];
for (let i = 0; i < REMIND_MESSAGES.length; i++) {
  b.triggerReminder();
  titles.push(b.status(t, 0).message.title);
  b.skip(t);
}
check(`${REMIND_MESSAGES.length} lần nhắc liên tiếp: KHÔNG lặp lại câu nào`,
  new Set(titles).size === REMIND_MESSAGES.length);
b.triggerReminder();
check('hết bộ thì quay vòng lại câu đầu', b.status(t, 0).message.title === titles[0]);
b = fresh({ ...S, intervalMins: 30 });
b.triggerReminder();
const msg = b.status(t, 0).message;
check('lời nhắc chèn đúng số phút đã cài (30)', msg.body.includes('30 phút'));
check('không còn sót ký hiệu {mins} chưa thay', !msg.body.includes('{mins}'));
fx = b.remindEffects();
check('notification dùng CÙNG câu với cửa sổ nhắc (không lệch nhau)',
  fx.find((x) => x.type === 'notify').title === b.status(t, 0).message.title);
b = fresh();
const bTitles = [];
for (let i = 0; i < BREAK_OVER_MESSAGES.length; i++) {
  b.triggerReminder(); b.takeBreak(t);
  bTitles.push(run(b, 5 * 60 + 1).find((x) => x.type === 'notify').title);
}
check('câu báo hết giờ nghỉ cũng xoay vòng, không lặp',
  new Set(bTitles).size === BREAK_OVER_MESSAGES.length);

console.log('9. Cấu hình biên: interval tối thiểu 5 phút');
b = fresh({ intervalMins: 5, breakMins: 1, idleMins: 1 });
run(b, 5 * 60 + 1);
check('interval 5 phút vẫn nhắc đúng', b.phase === 'reminding');
b.takeBreak(t);
run(b, 61);
check('nghỉ 1 phút kết thúc đúng', b.phase === 'working');
b = fresh({ intervalMins: 240, breakMins: 60, idleMins: 60 });
run(b, 239 * 60);
check('interval tối đa 240 phút: chưa nhắc sớm', b.phase === 'working');

console.log('10. Chạy dài 8 tiếng liên tục — kiểm tra ổn định & không rò trạng thái');
b = fresh();
let reminders = 0, notifies = 0;
const VALID = ['working', 'reminding', 'breaking', 'idle', 'paused'];
for (let s = 0; s < 8 * 3600; s++) {
  const out = b.tick((t += 1000), 0);
  reminders += count(out, 'openReminder');
  notifies += count(out, 'notify');
  if (b.phase === 'reminding') b.takeBreak(t); // người dùng luôn nghe lời
  assert.ok(VALID.includes(b.phase), `trạng thái lạ: ${b.phase}`);
}
check(`8 giờ liên tục: không crash, trạng thái luôn hợp lệ`, true);
check(`số lần nhắc hợp lý (${reminders} lần, kỳ vọng ~9 với chu kỳ 45+5 phút)`,
  reminders >= 8 && reminders <= 10);
check('mỗi lần nhắc kèm đúng thông báo (nhắc + báo hết giờ nghỉ)', notifies === reminders * 2);
check('kết thúc 8 giờ ở trạng thái sạch', VALID.includes(b.phase));

console.log('11. Chạy dài 8 tiếng với người dùng hay rời máy');
b = fresh();
let ok = true;
for (let s = 0; s < 8 * 3600; s++) {
  // cứ mỗi 20 phút thì rời máy 6 phút
  const inCycle = s % 1200;
  const idle = inCycle > 840 ? (inCycle - 840) : 0;
  b.tick((t += 1000), idle);
  if (b.phase === 'reminding') b.takeBreak(t);
  if (!VALID.includes(b.phase)) ok = false;
}
check('8 giờ với idle xen kẽ: không kẹt, không crash', ok);
check('kết thúc ở trạng thái hợp lệ', VALID.includes(b.phase));

console.log(`\nTẤT CẢ ${passed} KIỂM TRA ĐỀU ĐẠT ✅`);
