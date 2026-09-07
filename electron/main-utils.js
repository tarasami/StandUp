// PURE functions of the main process — split out of main.js so they can be unit-tested.
//
// Why this file exists: engine.js has very thorough test coverage and has never
// produced a bug, whereas every real bug found on 2026-08-10 lived in main.js —
// which had not a single test, because that file require()s electron and so cannot
// be loaded from plain Node. Any logic that does not need Electron belongs here.

const BOM = 0xFEFF;

// Parse the contents of settings.json. Returns an object, or null if it is broken
// or not an object.
function parseSettingsJson(text) {
  try {
    const s = String(text);
    // Strip the BOM (U+FEFF) before parsing: a file hand-edited with a Windows text
    // editor very easily picks one up, and JSON.parse throws on it — the result was
    // losing every setting and being sent through onboarding again, without a word
    // of warning. Compare the char code rather than using a regex, so no invisible
    // character ever appears in the source.
    const body = s.charCodeAt(0) === BOM ? s.slice(1) : s;
    const parsed = JSON.parse(body);
    // Arrays and null also survive JSON.parse but cannot serve as settings.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Height of the main window depending on whether the settings panel is OPEN (press
// the gear button to expand it) or closed. Both heights (h.compact / h.full) were
// measured for real with DevTools. Clamp to the work area so the window never
// extends under the taskbar; if it does not fit, letting the content scroll beats
// losing the buttons.
function mainWindowHeight(settingsOpen, maxHeight, h) {
  return Math.min(settingsOpen ? h.full : h.compact, maxHeight);
}

// Keep the window fully inside the work area after its height changes.
//   y = current top edge, height = NEW height, wa = workArea {y, height}.
// The main window grows by 480px when the settings panel expands. Changing only the
// height makes that growth go DOWNWARD: a window centred on a 1080px screen (y=328)
// ends up with its bottom at 1153 while the work area stops at 1040 — the "Save
// settings" button falls off the screen, so the user sees the settings cut short
// and cannot save.
// Move it up JUST ENOUGH, no further: wherever the user parked the window, respect it.
// Clamp the top edge too, in case the window is taller than the whole work area (a
// very short screen) — better to let the bottom overflow and the content scroll than
// to lose the title bar entirely.
function clampWindowY(y, height, wa) {
  return Math.round(Math.max(wa.y, Math.min(y, wa.y + wa.height - height)));
}

// Gap from the screen edge when the reminder window sits in a corner.
const REMINDER_MARGIN = 16;

// Top-left coordinates for the reminder window, per the chosen position.
//   wa  = workArea {x, y, width, height} — taskbar already subtracted.
//   win = {width, height} of the reminder window.
// Returns integer {x, y}. Only 'center' is a special case; every other value
// (garbage included) falls back to the bottom-right corner — clampSettings already
// filters the input, so this is just a final safety net.
function reminderXY(pos, wa, win) {
  if (pos === 'center') {
    return {
      x: Math.round(wa.x + (wa.width - win.width) / 2),
      y: Math.round(wa.y + (wa.height - win.height) / 2),
    };
  }
  return {
    x: wa.x + wa.width - win.width - REMINDER_MARGIN,
    y: wa.y + wa.height - win.height - REMINDER_MARGIN,
  };
}

// Format one log line: LOCAL time (easier to read while debugging) + level +
// message. It takes a ready-made Date, which keeps the function pure and testable.
// Newlines inside the message become spaces so every event stays on exactly one line.
function formatLogLine(date, level, message) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} `
    + `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`;
  const msg = String(message).replace(/[\r\n]+/g, ' ');
  return `${ts}  ${String(level).toUpperCase().padEnd(5)}  ${msg}`;
}

// Is it time to rotate the log file: current size has reached or passed the limit.
function shouldRotateLog(currentBytes, maxBytes) {
  return Number(currentBytes) >= Number(maxBytes);
}

// Turn the result of SHQueryUserNotificationState (a Windows value of 1..7) into
// "are we allowed to pop the reminder window right now". ONLY 5
// (QUNS_ACCEPTS_NOTIFICATIONS) means a normal desktop → allowed. Every other value
// means this is a bad moment to interrupt: 1 locked/screensaver, 2 full-screen app
// (video, a presentation being watched), 3 full-screen D3D game, 4 presentation
// mode, 6 quiet time, 7 full-screen Store app. If we cannot read a valid number
// (a failed query returns -1, an empty string, garbage) → treat it as ALLOWED
// (fail-open): missing a reminder during full-screen is far better than silently
// disabling reminders altogether because one query to Windows broke.
const QUNS_ACCEPTS_NOTIFICATIONS = 5;
function notificationsAllowedFromState(raw) {
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 7) return true; // unknown → allow
  return n === QUNS_ACCEPTS_NOTIFICATIONS;
}

module.exports = {
  parseSettingsJson, mainWindowHeight, clampWindowY, reminderXY, REMINDER_MARGIN,
  formatLogLine, shouldRotateLog, notificationsAllowedFromState,
};
