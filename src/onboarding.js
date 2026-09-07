// First-run screen: pick an interval and go.
// Comments are English; strings the user reads stay Vietnamese (see CONTRIBUTING.md).
const api = window.standup;
const $ = (id) => document.getElementById(id);

const presets = [...document.querySelectorAll('.preset')];

// The preset buttons and the free-entry field always mirror each other: pressing a
// preset fills the field, and typing a value highlights a matching preset.
function syncPresets(mins) {
  presets.forEach((p) => p.classList.toggle('selected', Number(p.dataset.mins) === mins));
}

presets.forEach((p) => p.addEventListener('click', () => {
  const mins = Number(p.dataset.mins);
  $('in-interval').value = mins;
  syncPresets(mins);
}));

$('in-interval').addEventListener('input', () => syncPresets(Number($('in-interval').value)));

$('btn-start').addEventListener('click', async () => {
  $('btn-start').disabled = true;
  await api.completeOnboarding({
    intervalMins: Number($('in-interval').value),
    autoStart: $('in-autostart').checked,
    sound: $('in-sound').checked,
  });
});

// A dev build writes no startup entry (it would point at electron.exe inside
// node_modules).
api.getEnv().then(({ packaged }) => {
  if (!packaged) {
    $('autostart-note').textContent = '(chỉ có tác dụng ở bản cài đặt)';
    $('in-autostart').checked = false;
  }
});
