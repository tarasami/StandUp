// Renderer for the main window: status, countdown and the settings panel.
// Comments are English; strings the user reads stay Vietnamese (see CONTRIBUTING.md).
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

// Settings can change elsewhere (onboarding, and later the tray menu) while this
// window is hidden. Re-sync the form from the broadcast state — but do NOT touch the
// field the user is currently typing in.
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
  set('in-defer-fullscreen', s.deferFullscreen, 'checked');
  set('in-break-overlay', s.breakOverlay, 'checked');
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

// The alert sound is synthesised with Web Audio: no audio file to ship, no CSP
// trouble, and it keeps the "remind gently" spirit — two short sine notes, quiet.
let audioCtx = null;

async function playChime(kind) {
  try {
    audioCtx = audioCtx || new AudioContext();
    // We MUST await resume before scheduling: notes scheduled while the context is
    // suspended are already in the past by the time it wakes, so nothing plays.
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    console.log(`[chime] ${kind}, AudioContext state = ${audioCtx.state}`);
    // Reminder: rising (asks for attention). Break over: falling (soft, closing).
    const notes = kind === 'breakOver' ? [880, 587.33] : [587.33, 880];
    notes.forEach((freq, i) => {
      const t0 = audioCtx.currentTime + i * 0.18;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Fade in and out so there is no click at either end of the note.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.36);
    });
  } catch (err) {
    console.error('Chime failed to play:', err);
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
    deferFullscreen: $('in-defer-fullscreen').checked,
    breakOverlay: $('in-break-overlay').checked,
  });
  // Drop focus before syncing, otherwise the focused field keeps the value the user
  // typed instead of the clamped one (type 999 → it is saved as 240).
  document.activeElement?.blur();
  syncForm(saved);
  $('save-msg').textContent = 'Đã lưu ✓';
  setTimeout(() => ($('save-msg').textContent = ''), 2000);
});

// The gear button expands/collapses the settings panel. Tell main so the window can
// resize to fit — main owns the canonical height for each state, we do not measure
// pixels here.
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
