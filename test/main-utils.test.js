// Unit tests for the pure functions of the main process — run with: npm test
// Every real bug found on 2026-08-10 lived in the Electron layer, not in the engine.
// Whatever can be pulled out of that layer must have tests, starting here.
const assert = require('node:assert');
const {
  parseSettingsJson, mainWindowHeight, clampWindowY, reminderXY, REMINDER_MARGIN,
  formatLogLine, shouldRotateLog, notificationsAllowedFromState,
} = require('../electron/main-utils');

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('1. parseSettingsJson — surviving a corrupted settings file');
const GOOD = '{ "intervalMins": 45, "breakMins": 5 }';
// Use the char code, never write an invisible character into the source.
const BOM = String.fromCharCode(0xFEFF);
check('valid JSON parses', parseSettingsJson(GOOD).intervalMins === 45);
// Regression: a file with a BOM used to wipe every setting and force onboarding again.
check('a file with a leading BOM still parses', parseSettingsJson(`${BOM}${GOOD}`).intervalMins === 45);
check('BOM plus a newline still parses', parseSettingsJson(`${BOM}\n${GOOD}`).breakMins === 5);
check('JSON truncated mid-file -> null', parseSettingsJson('{ "intervalMins": 4') === null);
check('empty file -> null', parseSettingsJson('') === null);
check('complete garbage -> null', parseSettingsJson('not json at all') === null);
// The three below are all valid JSON but unusable as settings.
check('null -> null', parseSettingsJson('null') === null);
check('an array -> null', parseSettingsJson('[1,2,3]') === null);
check('a bare number -> null', parseSettingsJson('42') === null);
check('undefined does not throw', parseSettingsJson(undefined) === null);

console.log('2. mainWindowHeight — height depending on the settings panel');
// Representative values; this only tests that the function PICKS the right slot,
// not the real measurements.
const H = { compact: 384, full: 750 };
check('settings closed -> compact', mainWindowHeight(false, 1080, H) === 384);
check('settings OPEN -> full', mainWindowHeight(true, 1080, H) === 750);
// Clamp to the work area: a short screen cannot hold the wanted height.
check('short screen -> full is clamped to the work area', mainWindowHeight(true, 700, H) === 700);
check('very short screen -> even compact is clamped', mainWindowHeight(false, 300, H) === 300);

console.log('2b. clampWindowY — growing the window without pushing it off screen');
// A 1920x1080 screen with the taskbar at the bottom -> work area 1040 tall, origin (0,0).
const WORK = { x: 0, y: 0, width: 1920, height: 1040 };
check('already fits -> left exactly where it was', clampWindowY(300, 384, WORK) === 300);
// The exact case the user reported: a window centred at y=328 expanding to 864 would
// reach 1192 — it must move up to 176 so the Save button does not fall off screen.
check('grows past the bottom -> moved up just enough', clampWindowY(328, 864, WORK) === 176);
check('after moving up, the bottom meets the work-area edge', clampWindowY(328, 864, WORK) + 864 === 1040);
check('already near the bottom -> still clamped back inside', clampWindowY(1000, 384, WORK) === 656);
check('shrinking does not move it', clampWindowY(176, 384, WORK) === 176);
// Taller than the whole work area: keep the top edge — an overflowing bottom beats
// losing the title bar.
check('taller than the screen -> pinned to the top edge', clampWindowY(300, 1200, WORK) === 0);
// A second display above/below, or a taskbar across the top -> wa.y is not 0.
const WORK_TOP = { x: 0, y: -1080, width: 1920, height: 1050 };
check('secondary display above (negative y) -> clamped to wa.y', clampWindowY(-1500, 384, WORK_TOP) === -1080);
check('secondary display above -> clamped to its own bottom', clampWindowY(-200, 864, WORK_TOP) === -894);

console.log('3. reminderXY — placing the reminder window at the chosen position');
const WIN = { width: 380, height: 250 };
// A 1920x1080 screen with the taskbar at the bottom -> work area 1040 tall, origin (0,0).
const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const br = reminderXY('bottom-right', WA, WIN);
check('bottom-right: exactly 16px from the right edge',
  br.x === 1920 - 380 - REMINDER_MARGIN && br.x === 1524);
check('bottom-right: exactly 16px from the bottom edge',
  br.y === 1040 - 250 - REMINDER_MARGIN && br.y === 774);
// Matches a real measurement on the installed build: getBounds gives logical
// coordinates, while GetWindowRect reported (1516,774) — the 8px difference in x is
// the invisible DWM border; y matches exactly.
const ce = reminderXY('center', WA, WIN);
check('center: centred horizontally', ce.x === Math.round((1920 - 380) / 2) && ce.x === 770);
check('center: centred vertically', ce.y === Math.round((1040 - 250) / 2) && ce.y === 395);
// A work area with a shifted origin: a display to the right (x=1920), or a taskbar
// across the top (y=48).
const right = reminderXY('bottom-right', { x: 1920, y: 0, width: 1920, height: 1040 }, WIN);
check('display to the right: the origin x is added in', right.x === 1920 + 1920 - 380 - REMINDER_MARGIN);
const topbar = reminderXY('bottom-right', { x: 0, y: 48, width: 1920, height: 1032 }, WIN);
check('taskbar on top: y is measured from the work-area origin', topbar.y === 48 + 1032 - 250 - REMINDER_MARGIN);
const ctop = reminderXY('center', { x: 0, y: 48, width: 1920, height: 1032 }, WIN);
check('centring on a shifted work area: the origin y is added correctly', ctop.y === Math.round(48 + (1032 - 250) / 2));
// Odd sizes -> rounded, never fractional coordinates (setPosition needs integers).
const odd = reminderXY('center', { x: 0, y: 0, width: 1001, height: 1001 }, WIN);
check('odd sizes: the centred coordinates are rounded to integers',
  Number.isInteger(odd.x) && Number.isInteger(odd.y) && odd.x === 311);
// Safety net: an odd value reaching this far (clampSettings should have caught it)
// falls back to bottom-right.
check('an unknown position -> falls back to bottom-right', reminderXY('gibberish', WA, WIN).x === br.x);
check('an undefined position -> falls back to bottom-right', reminderXY(undefined, WA, WIN).y === br.y);

console.log('4. formatLogLine / shouldRotateLog — the event log');
// Months in Date are 0-based: 7 = August.
const D = new Date(2026, 7, 17, 9, 5, 3, 42);
check('formats the full date, time, milliseconds and level',
  formatLogLine(D, 'info', 'startup') === '2026-08-17 09:05:03.042  INFO   startup');
check('the ERROR level lines up correctly', formatLogLine(D, 'error', 'x') === '2026-08-17 09:05:03.042  ERROR  x');
check('the level is upper-cased', formatLogLine(D, 'warn', 'x').includes('WARN'));
// Single digits must be zero-padded (month/day/hour/milliseconds).
check('single digits are zero-padded',
  formatLogLine(new Date(2026, 0, 2, 3, 4, 5, 6), 'info', 'x').startsWith('2026-01-02 03:04:05.006'));
// An event must always stay on one line, even for a multi-line message (a stack trace).
check('newlines inside the message collapse onto one line',
  formatLogLine(D, 'error', 'error\nline2\r\nline3').split('\n').length === 1);
check('a non-string message does not throw',
  typeof formatLogLine(D, 'info', 42) === 'string');
check('rotation: below the limit -> no', shouldRotateLog(999999, 1000000) === false);
check('rotation: exactly at the limit -> yes', shouldRotateLog(1000000, 1000000) === true);
check('rotation: past the limit -> yes', shouldRotateLog(5000000, 1000000) === true);

console.log('5. notificationsAllowedFromState — only remind when Windows allows it');
const A = notificationsAllowedFromState;
// 5 = QUNS_ACCEPTS_NOTIFICATIONS: a normal desktop -> reminding is allowed.
check('state 5 (normal) -> allowed', A('5') === true);
check('a trailing newline still reads correctly', A('5\r\n') === true);
check('surrounding whitespace still reads correctly', A('  5  ') === true);
// Every "busy" state -> do NOT remind (hold off until they are free).
check('1 (locked / screensaver) -> hold off', A('1') === false);
check('2 (full-screen app: video/presentation) -> hold off', A('2') === false);
check('3 (full-screen D3D game) -> hold off', A('3') === false);
check('4 (presentation mode) -> hold off', A('4') === false);
check('6 (quiet time) -> hold off', A('6') === false);
check('7 (full-screen Store app) -> hold off', A('7') === false);
// Fail-open: if the query breaks, reminding beats disabling the feature outright.
check('-1 (failed query) -> fail-open, still reminds', A('-1') === true);
check('empty string -> fail-open', A('') === true);
check('non-numeric garbage -> fail-open', A('abc') === true);
check('a number outside 1..7 (99) -> fail-open', A('99') === true);
check('0 (outside the range) -> fail-open', A('0') === true);
check('undefined -> fail-open', A(undefined) === true);

console.log(`\nALL ${passed} CHECKS PASSED ✅`);
