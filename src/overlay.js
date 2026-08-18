// Màn nghỉ che toàn màn hình: một động tác giãn cơ cụ thể + đếm ngược.
// Luôn phải có đường thoát rõ ràng (nút + phím Esc) — che màn hình mà không
// thoát được thì app biến từ trợ lý thành kẻ bắt nạt, và đó là lý do số 1
// khiến người ta gỡ app cùng loại.
const api = window.standup;
const $ = (id) => document.getElementById(id);

// Động tác nghỉ mắt dùng hình MẮT; các động tác cơ thể dùng hình QUE; còn lại
// (nếu sau này thêm động tác chưa vẽ hình) lùi về emoji.
const EYE_ANIMS = new Set(['eyes']);

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
  const fig = $('ov-fig');
  const eyes = $('ov-eyes');
  const icon = $('ov-icon');
  // Mặc định ẩn cả ba rồi bật đúng một cái — CSSOM (style.display), không phải
  // thuộc tính style nội tuyến, nên hợp lệ với CSP 'self'.
  fig.style.display = 'none';
  eyes.style.display = 'none';
  icon.style.display = 'none';
  if (st.anim && EYE_ANIMS.has(st.anim)) {
    eyes.setAttribute('class', 'ov-eyes look');
    eyes.style.display = 'block';
  } else if (st.anim) {
    fig.setAttribute('class', `ov-fig fig-${st.anim}`);
    fig.style.display = 'block';
  } else {
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
