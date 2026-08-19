// Màn nghỉ che toàn màn hình: một động tác giãn cơ cụ thể + đếm ngược.
// Luôn phải có đường thoát rõ ràng (nút + phím Esc) — che màn hình mà không
// thoát được thì app biến từ trợ lý thành kẻ bắt nạt, và đó là lý do số 1
// khiến người ta gỡ app cùng loại.
const api = window.standup;
const $ = (id) => document.getElementById(id);

// Động tác nào cần hình RIÊNG thay cho hình que nhìn thẳng. Còn lại dùng hình
// que với class fig-<anim>; động tác chưa vẽ hình thì lùi về emoji.
const SPECIAL = {
  eyes: { id: 'ov-eyes', cls: 'ov-eyes look' },  // nghỉ mắt — que người không có mặt
  bend: { id: 'ov-side', cls: 'ov-side fold' },  // gập lưng — phải nhìn nghiêng mới đọc được
};
const VISUAL_IDS = ['ov-fig', 'ov-side', 'ov-eyes', 'ov-icon'];

function fmt(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Chỉ đổi hình khi TÊN động tác đổi, tránh khởi động lại animation mỗi giây
// (mỗi tick trạng thái phát về một lần).
let shownStretch = null;
function paintStretch(st) {
  if (!st || st.name === shownStretch) return;
  shownStretch = st.name;
  // Ẩn hết rồi bật đúng một cái — dùng CSSOM (style.display), không phải thuộc
  // tính style nội tuyến, nên hợp lệ với CSP 'self'.
  for (const id of VISUAL_IDS) $(id).style.display = 'none';
  const special = st.anim ? SPECIAL[st.anim] : null;
  if (special) {
    const el = $(special.id);
    el.setAttribute('class', special.cls);
    el.style.display = 'block';
  } else if (st.anim) {
    const fig = $('ov-fig');
    fig.setAttribute('class', `ov-fig fig-${st.anim}`);
    fig.style.display = 'block';
  } else {
    const icon = $('ov-icon');
    icon.textContent = st.icon;
    icon.style.display = 'block';
  }
  $('ov-name').textContent = st.name;
  $('ov-text').textContent = st.text;
}

function render(st) {
  if (st.phase !== 'breaking') return; // sắp bị ẩn rồi, khỏi vẽ lại
  $('ov-countdown').textContent = fmt(st.remainingSecs);
  paintStretch(st.stretch); // động tác do engine chọn — cùng nguồn với nhật ký
}

function backToWork() {
  api.action('skip');
}

$('ov-skip').addEventListener('click', backToWork);
// Esc là lối thoát ai cũng thử đầu tiên khi một cửa sổ chiếm hết màn hình.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') backToWork();
});

api.getStatus().then(render);
api.onStatus(render);
