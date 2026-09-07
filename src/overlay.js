// The full-screen break overlay: one concrete stretch plus a countdown.
// There must always be an obvious way out (a button and the Esc key) — covering the
// screen with no escape turns the app from an assistant into a bully, and that is the
// number one reason people uninstall apps of this kind.
// Comments are English; strings the user reads stay Vietnamese (see CONTRIBUTING.md).
const api = window.standup;
const $ = (id) => document.getElementById(id);

// Which stretches need their OWN figure instead of the front-facing stick figure.
// The rest use that figure with the class fig-<anim>; a stretch with no drawing yet
// falls back to its emoji.
const SPECIAL = {
  eyes: { id: 'ov-eyes', cls: 'ov-eyes look' },  // eye rest — a stick figure has no face
  bend: { id: 'ov-side', cls: 'ov-side fold' },  // forward bend — only readable from the side
};
const VISUAL_IDS = ['ov-fig', 'ov-side', 'ov-eyes', 'ov-icon'];

function fmt(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Only swap the figure when the stretch NAME changes, so the animation does not
// restart every second (state is broadcast once per tick).
let shownStretch = null;
function paintStretch(st) {
  if (!st || st.name === shownStretch) return;
  shownStretch = st.name;
  // Hide everything, then show exactly one — via the CSSOM (style.display) rather
  // than an inline style attribute, so it stays valid under a 'self'-only CSP.
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
  if (st.phase !== 'breaking') return; // about to be hidden, no point redrawing
  $('ov-countdown').textContent = fmt(st.remainingSecs);
  paintStretch(st.stretch); // the stretch the engine picked — same source as the log
}

function backToWork() {
  api.action('skip');
}

$('ov-skip').addEventListener('click', backToWork);
// Esc is the first escape everyone tries when a window takes over the screen.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') backToWork();
});

api.getStatus().then(render);
api.onStatus(render);
