const api = window.standup;
const $ = (id) => document.getElementById(id);

const presets = [...document.querySelectorAll('.preset')];

// Nút preset và ô nhập tay luôn phản chiếu lẫn nhau: bấm preset thì ô nhập đổi
// theo, gõ tay thì preset nào khớp sẽ sáng lên.
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

// Bản dev không ghi mục khởi động (sẽ trỏ vào electron.exe trong node_modules).
api.getEnv().then(({ packaged }) => {
  if (!packaged) {
    $('autostart-note').textContent = '(chỉ có tác dụng ở bản cài đặt)';
    $('in-autostart').checked = false;
  }
});
