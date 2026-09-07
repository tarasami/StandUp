// Unit tests for the engine — run with: npm test
// Ticks second by second exactly like the real app; the large time jumps exist only
// to exercise sleep/hibernate detection and clock adjustments.
const assert = require('node:assert');
const {
  Engine, clampSettings, DEFAULT_SETTINGS, REMIND_MESSAGES, BREAK_OVER_MESSAGES,
  IGNORED_RENAG_SECS, STRETCH_IDEAS,
} = require('../electron/engine');

// Test defaults: sound off so effect counting stays simple; sound tests enable it.
const S = { intervalMins: 45, breakMins: 5, idleMins: 5, sound: false, autoStart: true, onboarded: true };
let t = 1_750_000_000_000; // an arbitrary epoch mark
let passed = 0;

function check(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

// Tick one second at a time, returning every effect collected.
function run(e, seconds, idle = 0) {
  const fx = [];
  for (let i = 0; i < seconds; i++) fx.push(...e.tick((t += 1000), idle));
  return fx;
}
const has = (fx, type) => fx.some((x) => x.type === type);
const count = (fx, type) => fx.filter((x) => x.type === type).length;
const fresh = (s = S) => new Engine(s, t);

console.log('1. Work cycle -> reminder');
const e = fresh();
check('starts in the working phase', e.phase === 'working');
let fx = run(e, 44 * 60);
check('44 minutes: no reminder yet', e.phase === 'working' && fx.length === 0);
fx = run(e, 61);
check('after 45 minutes: switches to reminding', e.phase === 'reminding');
check('opens the reminder window', has(fx, 'openReminder'));
check('does NOT fire a Windows toast when reminding (the window already says it)', !has(fx, 'notify'));
check('reminds EXACTLY ONCE, no spam', count(fx, 'openReminder') === 1);
fx = run(e, 120);
check('stays put in reminding, no piled-up repeat reminders', count(fx, 'openReminder') === 0);

console.log('2. Break -> break ends -> new cycle');
e.takeBreak(t);
check('pressing Break now -> breaking', e.phase === 'breaking');
fx = run(e, 5 * 60 + 1);
check('after the 5 minute break -> back to working', e.phase === 'working');
check('closes the reminder window and announces the break is over', has(fx, 'closeReminder') && has(fx, 'notify'));
const st = e.status(t, 0);
check('the new cycle counts from ~45 minutes', st.remainingSecs > 44 * 60 && st.remainingSecs <= 45 * 60);

console.log('3. Idle detection — away from the machine counts as a break');
fx = run(e, 1, 5 * 60);
check('idle >= threshold -> switches to idle', e.phase === 'idle');
run(e, 10, 5 * 60 + 5);
check('stays idle while still away', e.phase === 'idle');
fx = run(e, 1, 1);
check('back at the machine -> a new cycle starts by itself', e.phase === 'working');
check('no notification on returning (stays quiet)', !has(fx, 'notify'));

console.log('3b. Exact boundary of the idle threshold');
let b = fresh();
run(b, 5, 4 * 60 + 59);
check('idle 4:59 (below the 5:00 threshold): still working', b.phase === 'working');
run(b, 1, 5 * 60);
check('idle exactly 5:00: switches to idle', b.phase === 'idle');
b = fresh();
run(b, 1, 5 * 60);
run(b, 1, 4); // BACK_ACTIVE_SECS = 3
check('idle back down to 4s: not yet counted as returned', b.phase === 'idle');
run(b, 1, 3);
check('idle back down to 3s: counted as returned -> working', b.phase === 'working');

console.log('3c. Walking away RIGHT AFTER being reminded (pressing no button)');
b = fresh();
run(b, 45 * 60 + 1);
check('currently in reminding', b.phase === 'reminding');
fx = run(b, 1, 5 * 60);
check('standing up and leaving -> recorded as a break taken', b.phase === 'idle');
check('the reminder window closes itself instead of hanging on screen', has(fx, 'closeReminder'));

console.log('3d. Walking away during a break');
b = fresh();
b.triggerReminder(t);
b.takeBreak(t);
fx = run(b, 5 * 60 + 1, 4 * 60); // away for the whole break
check('the break still runs to completion while the user is away', b.phase === 'working');
check('still announces the end of the break', has(fx, 'notify'));

console.log('4. Sleep/hibernate — a large gap in time');
run(e, 5, 0);
e.tick((t += 30 * 60_000), 0);
check('after a 30 minute sleep -> new cycle, no reminder', e.phase === 'working');
check('the deadline is recomputed from the moment of waking', e.status(t, 0).remainingSecs > 44 * 60);

b = fresh();
run(b, 45 * 60 + 1);
fx = b.tick((t += 60 * 60_000), 0); // sleeps for an hour with the reminder on screen
check('sleeping while reminding -> new cycle', b.phase === 'working');
check('the reminder window is cleared away, not left hanging after waking', has(fx, 'closeReminder'));

b = fresh();
b.triggerReminder(t);
b.takeBreak(t);
fx = b.tick((t += 60 * 60_000), 0);
check('sleeping during a break -> new cycle plus window cleanup', b.phase === 'working' && has(fx, 'closeReminder'));

b = fresh();
b.pause(t, null);
b.tick((t += 60 * 60_000), 0);
check('sleeping while paused: does NOT resume by itself', b.phase === 'paused');

b = fresh();
b.tick((t += 80 * 1000), 0); // gap of 80s < SLEEP_GAP_SECS of 90
check('a short gap (80s, a brief freeze) is not mistaken for sleep', b.phase === 'working');

console.log('4b. System clock moved BACKWARDS (NTP sync / time zone change)');
b = fresh();
run(b, 60);
t -= 2 * 3600_000; // back two hours
b.tick(t, 0);
const backSt = b.status(t, 0);
check('never goes silent indefinitely: the deadline is pulled back to <= one cycle', backSt.remainingSecs <= 45 * 60);
check('still counting down normally', backSt.remainingSecs > 0);
run(b, 45 * 60 + 1);
check('still able to remind after the clock went backwards', b.phase === 'reminding');

b = fresh();
b.pause(t, 60);
t -= 5 * 3600_000; // back five hours while paused
b.tick(t, 0);
check('a timed pause does not get stuck forever', b.status(t, 0).remainingSecs <= 60 * 60);

console.log('5. Snooze and skip');
e.triggerReminder(t);
fx = e.snooze(t);
check('snooze -> working, window closed', e.phase === 'working' && has(fx, 'closeReminder'));
check('snoozes for exactly 5 minutes', e.status(t, 0).remainingSecs === 5 * 60);
run(e, 5 * 60 + 1);
check('after the 5 minute snooze -> reminds again', e.phase === 'reminding');
e.snooze(t);
run(e, 5 * 60 + 1);
check('snoozing several times in a row still works', e.phase === 'reminding');
fx = e.skip(t);
check('skip -> a full new cycle', e.phase === 'working' && e.status(t, 0).remainingSecs === 45 * 60);
// The "Back to work" button on the break screen also calls skip() — this branch had
// no test until now, and skip() had just gained its paused-state handling.
b = fresh();
b.triggerReminder(t);
b.takeBreak(t);
run(b, 30);
fx = b.skip(t);
check('skipping DURING A BREAK -> cuts the break short, starts a new cycle',
  b.phase === 'working' && b.status(t, 0).remainingSecs === 45 * 60 && has(fx, 'closeReminder'));
b = fresh();
b.breakNow(t);
run(b, 30);
b.skip(t);
check('a tray-menu break then skip also lands in a clean new cycle', b.phase === 'working');

console.log('5b. Out-of-context actions do not corrupt the state');
b = fresh();
check('pressing Break while working: ignored', b.takeBreak(t).length === 0 && b.phase === 'working');
check('snooze while working: ignored', b.snooze(t).length === 0 && b.phase === 'working');
check('skip while working: ignored', b.skip(t).length === 0 && b.phase === 'working');
b.pause(t, null);
check('Resume while paused -> working', b.resume(t) && b.phase === 'working' || b.phase === 'working');
check('Resume while working: harmless', (b.resume(t), b.phase === 'working'));

console.log('5c. Break now from the tray, from every phase');
for (const setup of ['working', 'idle', 'paused']) {
  b = fresh();
  if (setup === 'idle') run(b, 1, 5 * 60);
  if (setup === 'paused') b.pause(t, null);
  fx = b.breakNow(t);
  check(`"Break now" from ${setup} -> breaking plus a window`, b.phase === 'breaking' && has(fx, 'openReminder'));
}

console.log('5d. A reminder ignored too long (user still present) -> self-snooze, NEVER stuck');
// It used to be: ignoring one popup while still active = the app goes silent forever,
// because 'reminding' was only left by pressing a button or walking away (to idle).
b = fresh();
run(b, 45 * 60 + 1);
check('currently in reminding', b.phase === 'reminding');
run(b, IGNORED_RENAG_SECS - 5); // just short of the threshold, still active (idle=0)
check(`before ${IGNORED_RENAG_SECS}s: the reminder window stays up`, b.phase === 'reminding');
fx = run(b, 6); // past the threshold
check('past the ignore threshold -> returns to working by itself, never stuck in reminding', b.phase === 'working');
check('the reminder window is closed on self-snooze', has(fx, 'closeReminder'));
check('does NOT pop a new window (it just goes away, quietly)', !has(fx, 'openReminder'));
check('self-snooze = remind again in exactly 5 minutes (as if Snooze was pressed)',
  b.status(t, 0).remainingSecs > 4 * 60 && b.status(t, 0).remainingSecs <= 5 * 60);
run(b, 5 * 60 + 1);
check('after a self-snooze, it reminds again 5 minutes later as normal', b.phase === 'reminding');

// Walking away takes PRIORITY over the self-snooze: getting up must land in idle, not
// working — "took a break" must never be mistaken for "snoozed for later".
b = fresh();
run(b, 45 * 60 + 1);
fx = run(b, 1, 5 * 60); // idle spikes right as we enter reminding
check('leaving right after entering reminding -> idle (not mistaken for a self-snooze)', b.phase === 'idle');

// Twin regression of skip(): a TEST reminder fired while paused and then ignored for
// too long must RETURN to paused, never quietly resume.
b = fresh();
b.pause(t, null);
b.triggerReminder(t);
check('test reminder while paused: the reminder window is up', b.phase === 'reminding');
fx = run(b, IGNORED_RENAG_SECS + 2);
check('ignoring a test reminder too long -> back to paused, does NOT start running', b.phase === 'paused');
check('the reminder window is closed on the way back to paused', has(fx, 'closeReminder'));
run(b, 10 * 60);
check('still sitting quietly in the indefinite pause', b.phase === 'paused');

// A TIMED pause must keep its deadline too, not have it wiped by the self-snooze.
b = fresh();
b.pause(t, 60);
b.triggerReminder(t);
run(b, IGNORED_RENAG_SECS + 2);
check('timed pause: ignoring a test reminder -> still paused, deadline intact',
  b.phase === 'paused' && b.status(t, 0).remainingSecs > 55 * 60);

console.log('5e. Holding reminders back while Windows is busy (full-screen/presentation/game)');
// The deadline passes but canNotify=false -> STAY in working, never pop over full-screen.
b = fresh();
run(b, 45 * 60 - 1); // one second short of the deadline, still working
check('just short of the deadline: working', b.phase === 'working');
fx = [];
for (let i = 0; i < 120; i++) fx.push(...b.tick((t += 1000), 0, false)); // 2 minutes overdue while busy
check('while full-screen: the deadline passes and NO reminder pops', b.phase === 'working');
check('not a single openReminder while busy', !has(fx, 'openReminder'));
// Free again -> remind on the very next tick.
fx = b.tick((t += 1000), 0, true);
check('leaving full-screen -> the reminder pops immediately', b.phase === 'reminding' && has(fx, 'openReminder'));

// Omitting canNotify (defaults to true) = the old behaviour, unchanged.
b = fresh();
fx = [];
for (let i = 0; i < 45 * 60 + 1; i++) fx.push(...b.tick((t += 1000), 0));
check('canNotify omitted: still reminds exactly as before', b.phase === 'reminding' && has(fx, 'openReminder'));

// Waiting-because-busy, then the user leaves -> idle still wins (a real break happened).
b = fresh();
for (let i = 0; i < 45 * 60 + 5; i++) b.tick((t += 1000), 0, false); // overdue while busy
check('overdue but busy: still working (waiting for a free moment)', b.phase === 'working');
b.tick((t += 1000), 6 * 60, false); // leaves while we are waiting
check('leaving while waiting -> idle (never stuck in working)', b.phase === 'idle');

// A SNOOZED reminder falling due while busy must hold off too.
b = fresh();
b.triggerReminder(t);
b.snooze(t); // 5 minutes later, back to working
for (let i = 0; i < 5 * 60 + 30; i++) b.tick((t += 1000), 0, false);
check('a snoozed reminder falling due while busy -> still holds off', b.phase === 'working');
fx = b.tick((t += 1000), 0, true);
check('no longer busy -> the snoozed reminder pops', b.phase === 'reminding' && has(fx, 'openReminder'));

console.log('6. Pause');
b = fresh();
b.pause(t, 60);
check('pause for 60 minutes -> paused', b.phase === 'paused');
run(b, 30, 0);
check('during the pause: stays paused', b.phase === 'paused');
run(b, 5, 10 * 60);
check('going idle while paused: stays paused, does not jump to idle', b.phase === 'paused');
b.tick((t += 61 * 60_000), 0);
check('when the pause expires -> resumes by itself', b.phase === 'working');
b.pause(t, null);
b.tick((t += 8 * 3600_000), 0);
check('indefinite pause: never resumes by itself (not even after 8 hours)', b.phase === 'paused');
b.resume(t);
check('pressing Resume -> a new cycle', b.phase === 'working');

b = fresh();
b.triggerReminder(t);
fx = b.pause(t, 60);
check('pausing while reminding -> clears the reminder window', has(fx, 'closeReminder') && b.phase === 'paused');
b = fresh();
b.triggerReminder(t);
b.takeBreak(t);
fx = b.pause(t, 60);
check('pausing during a break -> clears the reminder window', has(fx, 'closeReminder') && b.phase === 'paused');
// Regression: "Test reminder" used to clear pauseUntil, so testing a reminder while
// paused lost the paused state — the app quietly started running behind the user.
b = fresh();
b.pause(t, null);
b.triggerReminder(t);
check('test reminder while paused: the reminder window shows', b.phase === 'reminding');
b.skip(t);
check('skipping a test reminder -> RETURNS to paused, does not run on', b.phase === 'paused');
run(b, 5 * 60);
check('still sitting quietly in the indefinite pause after 5 minutes', b.phase === 'paused');
b = fresh();
b.pause(t, 60);
b.triggerReminder(t);
b.skip(t);
check('a timed pause is handed back intact too',
  b.phase === 'paused' && b.status(t, 0).remainingSecs > 59 * 60);
run(b, 60 * 60 + 1);
check('when the pause expires it resumes normally', b.phase === 'working');
// The opposite: responding to a test reminder is deliberate, so the pause is dropped.
b = fresh();
b.pause(t, null);
b.triggerReminder(t);
b.takeBreak(t);
check('pressing Break now on a test reminder -> a real break, pause dropped', b.phase === 'breaking');
run(b, 5 * 60 + 1);
check('after the break, back to work and NOT back to paused', b.phase === 'working');
b = fresh();
b.pause(t, null);
b.triggerReminder(t);
b.snooze(t);
check('pressing Snooze on a test reminder -> 5 minutes later, pause dropped', b.phase === 'working');
run(b, 5 * 60 + 1);
check('after the snooze it reminds on schedule', b.phase === 'reminding');
// The ordinary path (not paused) must not change behaviour.
b = fresh();
b.triggerReminder(t);
b.skip(t);
check('not paused: skip still begins a new cycle as before',
  b.phase === 'working' && b.status(t, 0).remainingSecs === 45 * 60);

console.log('7. Changing settings mid-cycle');
b = fresh();
run(b, 10 * 60);
b.updateSettings(t, { intervalMins: 30, breakMins: 5, idleMins: 5 });
check('shortening the interval 45->30: the deadline contracts immediately', b.status(t, 0).remainingSecs <= 30 * 60);
b = fresh();
run(b, 10 * 60);
b.updateSettings(t, { intervalMins: 60, breakMins: 5, idleMins: 5 });
check('lengthening the interval 45->60: the running cycle is not suddenly extended',
  b.status(t, 0).remainingSecs <= 35 * 60);
run(b, 35 * 60 + 1);
check('the current cycle ends normally', b.phase === 'reminding');
b.skip(t);
check('only the NEXT cycle uses the 60 minute interval', b.status(t, 0).remainingSecs === 60 * 60);
b = fresh();
b.updateSettings(t, { intervalMins: 45, breakMins: 10, idleMins: 5 });
b.triggerReminder(t);
b.takeBreak(t);
check('changing the break length 5->10 takes effect on the very next break', b.status(t, 0).remainingSecs === 10 * 60);
// Regression: updateSettings used to clamp the deadline only in the WORKING branch, so
// shortening the break length DURING a break left the current break on the old, longer mark.
b = fresh();
b.triggerReminder(t);
b.takeBreak(t);
run(b, 60);
b.updateSettings(t, { ...S, breakMins: 2 });
check('mid-break, shortening 5->2 minutes: the break deadline contracts at once', b.status(t, 0).remainingSecs <= 2 * 60);
run(b, 2 * 60 + 1);
check('the just-shortened break ends on time', b.phase === 'working');
b = fresh();
b.triggerReminder(t);
b.takeBreak(t);
run(b, 60);
b.updateSettings(t, { ...S, breakMins: 30 });
check('mid-break, lengthening 5->30 minutes: the running break is not extended',
  b.status(t, 0).remainingSecs <= 4 * 60);

console.log('8. clampSettings — defence against garbage from the UI and from settings.json');
const c = clampSettings;
const kept = c({ intervalMins: 30, breakMins: 3, idleMins: 2 });
check('valid values are kept as they are',
  kept.intervalMins === 30 && kept.breakMins === 3 && kept.idleMins === 2);
check('interval too small (0) -> clamped up to 5', c({ intervalMins: 0 }).intervalMins === 5);
check('negative interval -> clamped up to 5', c({ intervalMins: -99 }).intervalMins === 5);
check('interval too large (9999) -> clamped down to 240', c({ intervalMins: 9999 }).intervalMins === 240);
check('empty string -> clamped to the lower bound', c({ intervalMins: '' }).intervalMins === 5);
check('letters -> back to the default of 45', c({ intervalMins: 'abc' }).intervalMins === 45);
check('null -> default', c({ intervalMins: null }).intervalMins === 5);
check('undefined -> default of 45', c({}).intervalMins === 45);
check('empty object / nothing at all -> all defaults',
  JSON.stringify(c(undefined)) === JSON.stringify(DEFAULT_SETTINGS));
check('broken JSON file (null) -> all defaults',
  JSON.stringify(c(null)) === JSON.stringify(DEFAULT_SETTINGS));
check('decimals are rounded', c({ intervalMins: 30.7 }).intervalMins === 31);
check('Infinity -> default', c({ intervalMins: Infinity }).intervalMins === 45);
check('NaN -> default', c({ intervalMins: NaN }).intervalMins === 45);
check('breakMins clamped into 1..60', c({ breakMins: 999 }).breakMins === 60 && c({ breakMins: 0 }).breakMins === 1);
check('idleMins clamped into 1..60', c({ idleMins: 999 }).idleMins === 60 && c({ idleMins: 0 }).idleMins === 1);
check('position "bottom-right" is kept', c({ reminderPosition: 'bottom-right' }).reminderPosition === 'bottom-right');
check('position "center" is kept', c({ reminderPosition: 'center' }).reminderPosition === 'center');
check('an unknown position (top-left, unsupported) -> default bottom-right',
  c({ reminderPosition: 'top-left' }).reminderPosition === 'bottom-right');
check('garbage position -> default', c({ reminderPosition: 'xyz' }).reminderPosition === 'bottom-right');
check('position of the wrong type (a number) -> default', c({ reminderPosition: 5 }).reminderPosition === 'bottom-right');
check('missing position -> default bottom-right', c({}).reminderPosition === 'bottom-right');
// Settings that came out of the sanitiser must always be usable by the Engine.
const clamped = c({ intervalMins: '', breakMins: 'x', idleMins: -5 });
b = new Engine(clamped, t);
run(b, clamped.intervalMins * 60 + 1);
check('the Engine runs correctly on freshly sanitised settings', b.phase === 'reminding');

console.log('8b. Boolean settings — start with Windows, sound, onboarding');
check('defaults: sound on, autoStart on, onboarding NOT done',
  DEFAULT_SETTINGS.sound === true && DEFAULT_SETTINGS.autoStart === true
  && DEFAULT_SETTINGS.onboarded === false);
check('valid booleans are kept', c({ sound: false }).sound === false && c({ autoStart: false }).autoStart === false);
check('the string "false" is NOT misread as true -> falls back to the default', c({ sound: 'false' }).sound === true);
check('the number 0 is not a boolean -> falls back to the default', c({ sound: 0 }).sound === true);
check('null -> falls back to the default', c({ onboarded: null }).onboarded === false);
check('onboarded=true is preserved (never re-runs onboarding)', c({ onboarded: true }).onboarded === true);
check('an old file (missing the newer fields) still loads, defaults filled in',
  c({ intervalMins: 30, breakMins: 5, idleMins: 5 }).sound === true);
// deferFullscreen: ON by default (hold back during full-screen); can be turned off;
// garbage -> default.
check('deferFullscreen defaults to ON', DEFAULT_SETTINGS.deferFullscreen === true);
check('deferFullscreen can be turned off (false is kept)', c({ deferFullscreen: false }).deferFullscreen === false);
check('deferFullscreen of the wrong type (the string "false") -> back to the default true', c({ deferFullscreen: 'false' }).deferFullscreen === true);
check('an old file without deferFullscreen -> defaults to ON', c({ intervalMins: 30 }).deferFullscreen === true);
// breakOverlay: ON by default (break takes over the screen with a stretch); can be off.
check('breakOverlay defaults to ON', DEFAULT_SETTINGS.breakOverlay === true);
check('breakOverlay can be turned off (false is kept)', c({ breakOverlay: false }).breakOverlay === false);
check('breakOverlay of the wrong type (the string "false") -> back to the default true', c({ breakOverlay: 'false' }).breakOverlay === true);
check('an old file without breakOverlay -> defaults to ON', c({ intervalMins: 30 }).breakOverlay === true);

console.log('8c. Sound — only plays when the user enabled it');
b = new Engine({ ...S, sound: true }, t);
fx = run(b, 45 * 60 + 1);
check('sound on: a sound effect accompanies the reminder', has(fx, 'sound'));
check('the sound kind is "remind"', fx.find((x) => x.type === 'sound').kind === 'remind');
b.takeBreak(t);
fx = run(b, 5 * 60 + 1);
check('sound on: there is a chime at the end of the break', has(fx, 'sound'));
check('the sound kind is "breakOver"', fx.find((x) => x.type === 'sound').kind === 'breakOver');
b = new Engine({ ...S, sound: false }, t);
fx = run(b, 45 * 60 + 1);
check('sound off: NO sound effect with the reminder', !has(fx, 'sound'));
check('sound off still opens the reminder window as normal', has(fx, 'openReminder'));
b.takeBreak(t);
fx = run(b, 5 * 60 + 1);
check('sound off: no chime at the end of the break', !has(fx, 'sound'));

console.log('8d. Variety of reminder texts — no repeats, correct minute substitution');
check(`the reminder set is complete (${REMIND_MESSAGES.length} texts)`, REMIND_MESSAGES.length >= 10);
check(`there is a break-over set (${BREAK_OVER_MESSAGES.length} texts)`, BREAK_OVER_MESSAGES.length >= 3);
check('every reminder text has a slot for the minute count',
  REMIND_MESSAGES.every((m) => m.body.includes('{mins}')));
check('no two reminder texts are identical',
  new Set(REMIND_MESSAGES.map((m) => m.title)).size === REMIND_MESSAGES.length);
b = fresh();
const titles = [];
for (let i = 0; i < REMIND_MESSAGES.length; i++) {
  b.triggerReminder(t);
  titles.push(b.status(t, 0).message.title);
  b.skip(t);
}
check(`${REMIND_MESSAGES.length} reminders in a row: NOT one text repeats`,
  new Set(titles).size === REMIND_MESSAGES.length);
b.triggerReminder(t);
check('once the set is exhausted it wraps back to the first text', b.status(t, 0).message.title === titles[0]);
b = fresh({ ...S, intervalMins: 30 });
b.triggerReminder(t);
const msg = b.status(t, 0).message;
check('the reminder carries the configured minute count (30)', msg.body.includes('30 phút'));
check('no leftover unsubstituted {mins} marker', !msg.body.includes('{mins}'));
fx = b.remindEffects();
check('reminding ONLY opens the window, with no Windows toast alongside',
  has(fx, 'openReminder') && !has(fx, 'notify'));
b = fresh();
const bTitles = [];
for (let i = 0; i < BREAK_OVER_MESSAGES.length; i++) {
  b.triggerReminder(t); b.takeBreak(t);
  bTitles.push(run(b, 5 * 60 + 1).find((x) => x.type === 'notify').title);
}
check('the break-over texts rotate too, with no repeats',
  new Set(bTitles).size === BREAK_OVER_MESSAGES.length);

console.log('9. Boundary configuration: minimum interval of 5 minutes');
b = fresh({ intervalMins: 5, breakMins: 1, idleMins: 1 });
run(b, 5 * 60 + 1);
check('a 5 minute interval still reminds correctly', b.phase === 'reminding');
b.takeBreak(t);
run(b, 61);
check('a 1 minute break ends correctly', b.phase === 'working');
b = fresh({ intervalMins: 240, breakMins: 60, idleMins: 60 });
run(b, 239 * 60);
check('maximum interval of 240 minutes: no early reminder', b.phase === 'working');

console.log('10. Running 8 hours straight — stability and no state leaks');
b = fresh();
let reminders = 0, notifies = 0;
const VALID = ['working', 'reminding', 'breaking', 'idle', 'paused'];
for (let s = 0; s < 8 * 3600; s++) {
  const out = b.tick((t += 1000), 0);
  reminders += count(out, 'openReminder');
  notifies += count(out, 'notify');
  if (b.phase === 'reminding') b.takeBreak(t); // a user who always complies
  assert.ok(VALID.includes(b.phase), `unknown phase: ${b.phase}`);
}
check(`8 hours straight: no crash, the phase is always valid`, true);
check(`a sensible number of reminders (${reminders}, expected ~9 for a 45+5 minute cycle)`,
  reminders >= 8 && reminders <= 10);
check('one toast per cycle — the break-over one, and NO toast when reminding', notifies === reminders);
check('ends the 8 hours in a clean state', VALID.includes(b.phase));

console.log('11. Running 8 hours with a user who often steps away');
b = fresh();
let ok = true;
for (let s = 0; s < 8 * 3600; s++) {
  // away for 6 minutes out of every 20
  const inCycle = s % 1200;
  const idle = inCycle > 840 ? (inCycle - 840) : 0;
  b.tick((t += 1000), idle);
  if (b.phase === 'reminding') b.takeBreak(t);
  if (!VALID.includes(b.phase)) ok = false;
}
check('8 hours with interleaved idle: never stuck, never crashes', ok);
check('ends in a valid phase', VALID.includes(b.phase));

console.log('12. Full-screen break overlay plus the stretch');
const SO = { ...S, breakOverlay: true };
// --- On: entering a break opens the overlay and puts the small reminder away ---
b = new Engine(SO, t);
run(b, 45 * 60 + 1);
fx = b.takeBreak(t);
check('overlay on: pressing "Break now" -> opens the overlay', has(fx, 'openOverlay'));
check('overlay on: also closes the small reminder (no two windows counting the same break)', has(fx, 'closeReminder'));
check('entering a break always comes with a stretch', b.stretch !== null && typeof b.stretch.name === 'string');
check('the stretch has an icon, a name and instructions',
  !!b.stretch.icon && !!b.stretch.name && b.stretch.text.length > 10);
check('the broadcast state carries the stretch (so the overlay can draw it)',
  b.status(t, 0).stretch.name === b.stretch.name);

// --- Every exit from a break must close the overlay ---
fx = run(b, 5 * 60 + 1);
check('break ends -> closes the overlay', has(fx, 'closeOverlay'));
check('break ends: the toast still fires as before', has(fx, 'notify'));

b = new Engine(SO, t);
b.breakNow(t);
fx = b.skip(t);
check('pressing "Back to work" mid-break -> closes the overlay', has(fx, 'closeOverlay'));

b = new Engine(SO, t);
b.breakNow(t);
fx = b.pause(t, 60);
check('pausing mid-break -> closes the overlay', has(fx, 'closeOverlay'));

b = new Engine(SO, t);
b.breakNow(t);
fx = b.tick((t += 10 * 60 * 1000), 0); // machine sleeps 10 minutes mid-break
check('waking mid-break -> closes the overlay', has(fx, 'closeOverlay'));
check('waking lands in a new cycle', b.phase === 'working');

// --- "Break now" from the tray menu ---
b = new Engine(SO, t);
fx = b.breakNow(t);
check('tray "Break now" (overlay on) -> opens the overlay', has(fx, 'openOverlay'));
check('tray "Break now" (overlay on) -> does NOT open the small reminder', !has(fx, 'openReminder'));

// --- Overlay off: the old behaviour is preserved ---
b = new Engine({ ...S, breakOverlay: false }, t);
run(b, 45 * 60 + 1);
fx = b.takeBreak(t);
check('overlay off: does NOT open the overlay', !has(fx, 'openOverlay'));
check('overlay off: keeps the reminder window so it can count the break down', !has(fx, 'closeReminder'));
fx = b.breakNow(t);
check('overlay off: tray "Break now" still opens the reminder window as before', has(fx, 'openReminder'));

// --- The overlay may only open during an actual break ---
b = new Engine(SO, t);
fx = run(b, 45 * 60 + 1);
check('while reminding (no break yet) it does NOT open the overlay', !has(fx, 'openOverlay') && b.phase === 'reminding');
fx = b.snooze(t);
check('pressing "Snooze" does not open the overlay either', !has(fx, 'openOverlay'));

// --- Stretch rotation: no repeats before the whole set is used ---
b = new Engine(SO, t);
const seen = [];
for (let i = 0; i < STRETCH_IDEAS.length; i++) {
  b.breakNow(t);
  seen.push(b.stretch.name);
  b.skip(t);
}
check(`the first ${STRETCH_IDEAS.length} breaks: ${STRETCH_IDEAS.length} DIFFERENT stretches`,
  new Set(seen).size === STRETCH_IDEAS.length);
b.breakNow(t);
check('once the set is exhausted it wraps back to the first stretch', b.stretch.name === seen[0]);
check('the stretch set is big enough not to get boring (>= 6)', STRETCH_IDEAS.length >= 6);

// --- The most important invariant: the overlay never gets stuck ---
// A window covering the whole screen that gets stuck effectively takes the user's
// machine away, so run for 8 hours and check: every open must be matched by a close.
b = new Engine(SO, t);
let opens = 0; let closes = 0;
for (let sec = 0; sec < 8 * 3600; sec++) {
  const out = b.tick((t += 1000), 0);
  opens += count(out, 'openOverlay');
  closes += count(out, 'closeOverlay');
  if (b.phase === 'reminding') {
    const a = b.takeBreak(t);
    opens += count(a, 'openOverlay');
    closes += count(a, 'closeOverlay');
  }
}
check(`8 hours straight: overlay opened ${opens} times, closed ${closes} — matched, never stuck`,
  opens > 0 && opens === closes);
check('ends the 8 hours without being trapped in a break', b.phase !== 'breaking');

console.log('12b. Every stretch has a figure the overlay can actually draw');
// The overlay knows exactly these 8 kinds (7 stick-figure poses plus the eyes). One
// mistyped anim key (say 'shoudlers') would make the overlay quietly fall back to the
// emoji — this test blocks that class of bug at the engine data level.
const KNOWN_ANIMS = new Set(['shoulders', 'neck', 'reach', 'bend', 'wrist', 'eyes', 'walk', 'calf']);
let stretchesOk = true, allHaveAnim = true;
for (const s of STRETCH_IDEAS) {
  if (!s.icon || !s.name || !(s.text && s.text.length > 10)) stretchesOk = false;
  if (!s.anim) allHaveAnim = false;
  else if (!KNOWN_ANIMS.has(s.anim)) stretchesOk = false;
}
check('every stretch has an icon, a name and instructions (>10 chars)', stretchesOk);
check('all 8 stretches use an anim the overlay knows how to draw', allHaveAnim && STRETCH_IDEAS.length === 8);

console.log(`\nALL ${passed} CHECKS PASSED ✅`);
