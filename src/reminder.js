// The floating reminder window; it doubles as the small break countdown when the
// break overlay is switched off.
// Comments are English; strings the user reads stay Vietnamese (see CONTRIBUTING.md).
const api = window.standup;
const $ = (id) => document.getElementById(id);

function fmt(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function render(st) {
  const breaking = st.phase === 'breaking';
  $('view-remind').classList.toggle('hidden', breaking);
  $('view-break').classList.toggle('hidden', !breaking);
  if (breaking) {
    $('break-countdown').textContent = fmt(st.remainingSecs);
  } else if (st.message) {
    // Use the exact text the engine picked, so the window and the notification never
    // say different things.
    $('remind-title').textContent = st.message.title;
    $('remind-text').textContent = st.message.body;
  }
}

$('btn-break').addEventListener('click', () => api.action('takeBreak'));
$('btn-snooze').addEventListener('click', () => api.action('snooze'));
$('btn-skip').addEventListener('click', () => api.action('skip'));
$('btn-endbreak').addEventListener('click', () => api.action('skip'));

api.getStatus().then(render);
api.onStatus(render);
