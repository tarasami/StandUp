const api = window.standup;
const $ = (id) => document.getElementById(id);

const PHASE_TEXT = {
  working: ['Đang làm việc', 'đến lần nhắc tiếp theo'],
  reminding: ['Đến giờ vận động!', 'hãy đứng dậy đi lại một chút'],
  breaking: ['Đang nghỉ 🧘', 'còn lại của giờ nghỉ'],
  idle: ['Bạn đang rời máy', 'chu kỳ mới bắt đầu khi bạn quay lại'],
  paused: ['Đang tạm dừng', 'bấm Tiếp tục để chạy lại'],
};

let paused = false;

function fmt(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Cài đặt có thể đổi từ nơi khác (onboarding, lần sau là menu tray) trong khi
// cửa sổ này đang ẩn. Đồng bộ lại form theo trạng thái phát về — nhưng KHÔNG
// đụng vào ô người dùng đang gõ dở.
function syncForm(s) {
  const set = (id, val, prop = 'value') => {
    const el = $(id);
    if (el !== document.activeElement) el[prop] = val;
  };
  set('in-interval', s.intervalMins);
  set('in-break', s.breakMins);
  set('in-idle', s.idleMins);
  set('in-position', s.reminderPosition);
  set('in-sound', s.sound, 'checked');
  set('in-autostart', s.autoStart, 'checked');
}

function render(st) {
  paused = st.phase === 'paused';
  if (st.settings) syncForm(st.settings);
  const [label, hint] = PHASE_TEXT[st.phase] || ['…', ''];
  $('phase-label').textContent = label;
  $('phase-hint').textContent = hint;
  const showTimer =
    st.phase === 'working' || st.phase === 'breaking' || (paused && st.remainingSecs > 0);
  $('countdown').textContent = showTimer ? fmt(st.remainingSecs) : '—';
  $('btn-pause').textContent = paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
  document.body.dataset.phase = st.phase;
}

// Âm báo tổng hợp bằng Web Audio: không cần file nhạc, không vướng CSP, và
// giữ được tinh thần "nhắc nhẹ nhàng" — hai nốt sine ngắn, âm lượng thấp.
let audioCtx = null;

async function playChime(kind) {
  try {
    audioCtx = audioCtx || new AudioContext();
    // PHẢI đợi resume xong mới lên lịch: nếu lên lịch lúc context còn ngủ thì
    // đến khi tỉnh, currentTime đã vượt qua các mốc đó và không nốt nào kêu.
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    console.log(`[am bao] ${kind}, trang thai AudioContext = ${audioCtx.state}`);
    // Nhắc: đi lên (gọi chú ý). Hết giờ nghỉ: đi xuống (êm, khép lại).
    const notes = kind === 'breakOver' ? [880, 587.33] : [587.33, 880];
    notes.forEach((freq, i) => {
      const t0 = audioCtx.currentTime + i * 0.18;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Vào/ra mượt để không nghe thấy tiếng "cạch" ở đầu và cuối nốt.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    });
  } catch (err) {
    console.error('Không phát được âm báo:', err);
  }
}

async function init() {
  syncForm(await api.getSettings());
  const { packaged } = await api.getEnv();
  if (!packaged) $('autostart-note').textContent = '(chỉ có tác dụng ở bản cài đặt)';
  render(await api.getStatus());
  api.onStatus(render);
  api.onSound(playChime);
}

$('btn-save').addEventListener('click', async () => {
  const saved = await api.setSettings({
    intervalMins: +$('in-interval').value,
    breakMins: +$('in-break').value,
    idleMins: +$('in-idle').value,
    reminderPosition: $('in-position').value,
    sound: $('in-sound').checked,
    autoStart: $('in-autostart').checked,
  });
  // Bỏ focus trước khi đồng bộ, nếu không ô đang focus sẽ không nhận giá trị
  // đã được kẹp về biên (ví dụ gõ 999 → lưu thành 240).
  document.activeElement?.blur();
  syncForm(saved);
  $('save-msg').textContent = 'Đã lưu ✓';
  setTimeout(() => ($('save-msg').textContent = ''), 2000);
});

// Nút ⚙: xổ phần cài đặt ra/vào. Báo main để cửa sổ co/giãn cho vừa nội dung —
// main giữ chiều cao chuẩn cho từng trạng thái, không đo lại pixel ở đây.
let settingsOpen = false;
function toggleSettings() {
  settingsOpen = !settingsOpen;
  $('settings-panel').classList.toggle('hidden', !settingsOpen);
  $('btn-settings').classList.toggle('active', settingsOpen);
  api.toggleSettings(settingsOpen);
}
$('btn-settings').addEventListener('click', toggleSettings);

$('btn-test').addEventListener('click', () => api.action('test'));
$('btn-pause').addEventListener('click', () => api.action(paused ? 'resume' : 'pauseIndef'));

init();
