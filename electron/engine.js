// Engine — StandUp's pure state machine, free of any Electron dependency (unit-testable).
//
// Phases:
//   working   — inside a sitting cycle, counting down to the deadline
//   reminding — time is up, the reminder window is open, waiting for the user
//   breaking  — on a break, counting down to its end
//   idle      — the user left the machine (treated as a natural break)
//   paused    — the user paused on purpose
//
// Every time value is epoch milliseconds (absolute wall clock) so the app survives
// sleep/hibernate: a long enough sleep counts as a break and starts a new cycle.
//
// NOTE ON LANGUAGE: comments are English, but every string the user actually reads
// (reminder texts, stretch names and instructions) stays Vietnamese — that is the
// product's language. See CONTRIBUTING.md.

const PHASE = {
  WORKING: 'working',
  REMINDING: 'reminding',
  BREAKING: 'breaking',
  IDLE: 'idle',
  PAUSED: 'paused',
};

// Where the reminder window appears. Only two choices, to keep the settings panel
// small; the default is the bottom-right corner (where Windows toasts usually show
// up, and where it does not cover what you are working on).
const REMINDER_POSITIONS = ['bottom-right', 'center'];

const DEFAULT_SETTINGS = {
  intervalMins: 45,
  breakMins: 5,
  idleMins: 5,
  sound: true,
  autoStart: true,
  reminderPosition: 'bottom-right',
  deferFullscreen: true, // hold reminders back during full-screen (video/game/presentation)
  breakOverlay: true,    // break takes over the screen and shows one stretch
  onboarded: false,
};

// Sanitise settings coming from the renderer or from the JSON file on disk: both can
// carry garbage (empty strings, NaN, negatives, a hand-edited file). Out-of-range
// numbers are clamped to the bounds; non-numbers fall back to the default.
function clampSettings(raw) {
  const num = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
  // Unknown values (garbage strings, typos, wrong types) fall back to the default.
  const oneOf = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  return {
    intervalMins: num(raw?.intervalMins, 5, 240, DEFAULT_SETTINGS.intervalMins),
    breakMins: num(raw?.breakMins, 1, 60, DEFAULT_SETTINGS.breakMins),
    idleMins: num(raw?.idleMins, 1, 60, DEFAULT_SETTINGS.idleMins),
    sound: bool(raw?.sound, DEFAULT_SETTINGS.sound),
    autoStart: bool(raw?.autoStart, DEFAULT_SETTINGS.autoStart),
    reminderPosition: oneOf(raw?.reminderPosition, REMINDER_POSITIONS, DEFAULT_SETTINGS.reminderPosition),
    deferFullscreen: bool(raw?.deferFullscreen, DEFAULT_SETTINGS.deferFullscreen),
    breakOverlay: bool(raw?.breakOverlay, DEFAULT_SETTINGS.breakOverlay),
    onboarded: bool(raw?.onboarded, DEFAULT_SETTINGS.onboarded),
  };
}

// Reminder texts, used in rotation. Reading the same sentence over and over is the
// fastest route to the user quitting the app — so the tone is friendly, never bossy
// or judgemental. {mins} = how many minutes they have been sitting.
const REMIND_MESSAGES = [
  { title: 'Đến giờ vận động rồi! 🚶', body: 'Bạn đã ngồi {mins} phút liên tục. Đứng dậy đi lại một chút nhé.' },
  { title: 'Nghỉ chút nào 🌿', body: '{mins} phút trôi qua rồi. Vươn vai, duỗi chân cho thoải mái.' },
  { title: 'Cơ thể cần chuyển động 💪', body: 'Đã {mins} phút ngồi yên. Đứng dậy vài phút thôi, đỡ mỏi lắm.' },
  { title: 'Tạm rời màn hình nhé 👀', body: 'Sau {mins} phút, mắt và lưng đều cần nghỉ. Đi lại một vòng nào.' },
  { title: 'Giãn cơ tí nào 🧘', body: 'Bạn đã tập trung {mins} phút liền. Xoay vai, vươn người cho dễ chịu.' },
  { title: 'Đứng dậy thôi! 🙆', body: '{mins} phút rồi đó. Một vòng ngắn quanh phòng là đủ.' },
  { title: 'Nghỉ ngắn, khỏe dài 🌱', body: 'Đã ngồi {mins} phút. Vài phút vận động giúp bạn tỉnh táo hơn.' },
  { title: 'Lưng bạn đang nhắc đấy 🪑', body: 'Sau {mins} phút ngồi, hãy đứng lên duỗi lưng một chút nhé.' },
  { title: 'Uống nước và đi lại nào 💧', body: '{mins} phút đã qua. Đứng dậy lấy cốc nước cũng là vận động.' },
  { title: 'Thời gian cho đôi chân 🦵', body: 'Bạn ngồi {mins} phút rồi. Đi vài bước cho máu lưu thông nhé.' },
  { title: 'Nghỉ một nhịp nhé ☕', body: 'Đã {mins} phút liên tục. Rời ghế vài phút rồi quay lại tiếp.' },
  { title: 'Vươn vai một cái 🌤️', body: 'Sau {mins} phút, cơ vai gáy cần được thư giãn. Đứng dậy nào!' },
];

const BREAK_OVER_MESSAGES = [
  { title: 'Nghỉ xong rồi ✅', body: 'Bắt đầu phiên làm việc mới. Cố lên!' },
  { title: 'Quay lại nhé 🚀', body: 'Hết giờ nghỉ. Chúc bạn một phiên tập trung thật tốt.' },
  { title: 'Sẵn sàng chưa? ✨', body: 'Giờ nghỉ kết thúc. Cơ thể đã được nạp lại năng lượng.' },
  { title: 'Tiếp tục thôi 💼', body: 'Nghỉ đủ rồi, mình làm tiếp nào.' },
];

// A break that only counts down invites you to sit there watching the number tick
// and then go straight back to work — exactly what stops "took a break" from
// becoming "actually moved". So every break offers ONE concrete stretch, short
// enough to do on the spot. They rotate in order like the reminder texts, so none
// repeats before the whole set has been used. Deliberately kept ordinary: no
// strenuous moves and no medical claims.
const STRETCH_IDEAS = [
  { icon: '🙆', name: 'Xoay vai', anim: 'shoulders', text: 'Xoay vai ra sau 10 vòng, rồi ra trước 10 vòng. Thả lỏng hai tay, đừng gồng.' },
  { icon: '🦒', name: 'Duỗi cổ', anim: 'neck', text: 'Nghiêng đầu sang phải, giữ 15 giây rồi đổi bên. Giữ vai yên, chỉ nghiêng cổ.' },
  { icon: '🙌', name: 'Vươn người', anim: 'reach', text: 'Vươn thẳng hai tay lên cao hết cỡ, hít sâu. Giữ 15 giây rồi thở ra.' },
  { icon: '🤸', name: 'Gập lưng', anim: 'bend', text: 'Từ từ gập người xuống, hai tay buông với về phía bàn chân. Cong gối nhẹ nếu căng.' },
  { icon: '🖐️', name: 'Giãn cổ tay', anim: 'wrist', text: 'Xoay tròn hai cổ tay nhiều vòng cho mềm khớp, thả lỏng bàn tay.' },
  { icon: '👀', name: 'Cho mắt nghỉ', anim: 'eyes', text: 'Đưa mắt nhìn ra xa, lướt chậm quanh phòng trong 20 giây cho mắt giãn.' },
  { icon: '🚶', name: 'Đi vài bước', anim: 'walk', text: 'Rời ghế, đi một vòng quanh phòng. Tiện tay lấy cốc nước thì càng tốt.' },
  { icon: '🦵', name: 'Nhón chân', anim: 'calf', text: 'Đứng thẳng, nhón gót lên rồi hạ xuống 15 lần cho máu chân lưu thông.' },
];

const SNOOZE_MINS = 5;
// A reminder ignored for too long WHILE the user is still at the machine (i.e. they
// did not walk away, which would flip us to idle) must never leave the app stuck in
// 'reminding' and silent forever: ignoring ONE popup would then be as good as
// quitting the app. Past this mark we snooze ourselves, exactly as if "Snooze" had
// been pressed. Set to 3 minutes: long enough not to nag someone mid-thought, short
// enough to pull the app out of the dead end. Must be > 120s, because a test parks
// the engine in 'reminding' for exactly 120s before acting.
const IGNORED_RENAG_SECS = 180;
// A gap between two ticks larger than this means the machine just slept/hibernated
// (normal ticks are one second apart).
const SLEEP_GAP_SECS = 90;
// Idle time dropping below this means the user is back at the machine.
const BACK_ACTIVE_SECS = 3;

class Engine {
  constructor(settings, now) {
    this.settings = { ...settings };
    this.phase = PHASE.WORKING;
    this.deadline = now + this.intervalMs();
    this.pauseUntil = undefined; // number = timed pause, null = until resumed
    this.lastTick = now;
    // Rotate in order (not at random) so no text ever repeats before the whole set
    // has been used — easier to test, and less repetitive than true randomness.
    this.remindMsgIndex = 0;
    this.breakMsgIndex = 0;
    this.message = null; // reminder currently on show, shared with the reminder window
    this.remindingSince = 0; // when we entered 'reminding', to detect being ignored
    this.stretchIndex = 0;
    this.stretch = null; // the stretch for the break currently running
  }

  intervalMs() { return this.settings.intervalMins * 60_000; }
  breakMs() { return this.settings.breakMins * 60_000; }
  idleThresholdSecs() { return this.settings.idleMins * 60; }

  newCycle(now) {
    this.phase = PHASE.WORKING;
    this.deadline = now + this.intervalMs();
    this.pauseUntil = undefined;
    this.pauseSpanMs = undefined;
  }

  // A system clock moved BACKWARDS (NTP sync, the user changing time or time zone)
  // pushes the deadline further away than a whole cycle → the app goes silent
  // indefinitely. There is no way to know how long they have really been sitting, so
  // pull the deadline back to exactly one cycle from now.
  rebaseIfClockWentBack(now) {
    const span = this.phase === PHASE.BREAKING ? this.breakMs() : this.intervalMs();
    if (this.deadline > now + span) this.deadline = now + span;
    if (this.pauseUntil != null && this.pauseSpanMs != null
        && this.pauseUntil > now + this.pauseSpanMs) {
      this.pauseUntil = now + this.pauseSpanMs;
    }
  }

  status(now, idleSecs) {
    let remaining = 0;
    if (this.phase === PHASE.WORKING || this.phase === PHASE.BREAKING) {
      remaining = Math.max(0, Math.ceil((this.deadline - now) / 1000));
    } else if (this.phase === PHASE.PAUSED && this.pauseUntil != null) {
      remaining = Math.max(0, Math.ceil((this.pauseUntil - now) / 1000));
    }
    return {
      phase: this.phase,
      remainingSecs: remaining,
      idleSecs,
      settings: { ...this.settings },
      message: this.message,
      stretch: this.stretch,
    };
  }

  // Call about once a second. Returns a list of effects for the outer layer to run:
  //   {type:'openReminder'} | {type:'closeReminder'} | {type:'notify', title, body}
  // canNotify: whether Windows currently allows popping the reminder (false while the
  // user is full-screen / presenting / gaming). Defaults to true — the outer layer
  // supplies it.
  tick(now, idleSecs, canNotify = true) {
    const fx = [];
    const gapSecs = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (gapSecs < 0) this.rebaseIfClockWentBack(now);

    // A long enough sleep/hibernate = the user was away = they had their break.
    if (gapSecs >= SLEEP_GAP_SECS && gapSecs >= this.idleThresholdSecs() && this.phase !== PHASE.PAUSED) {
      if (this.phase === PHASE.REMINDING || this.phase === PHASE.BREAKING) {
        fx.push({ type: 'closeReminder' }, { type: 'closeOverlay' });
      }
      this.newCycle(now);
      return fx;
    }

    switch (this.phase) {
      case PHASE.WORKING:
        if (idleSecs >= this.idleThresholdSecs()) {
          this.phase = PHASE.IDLE;
        } else if (now >= this.deadline) {
          // Time to remind — but if Windows is busy (full-screen / presentation /
          // game) then HOLD OFF, or the always-on-top reminder would jump on top of
          // it. Stay in working; the deadline has passed, so every later tick checks
          // again and reminds the moment they are free. Do not move the deadline
          // (that would accumulate lateness) and do not count this as "ignored" —
          // nothing was shown, so there is nothing to ignore.
          if (canNotify) {
            this.phase = PHASE.REMINDING;
            this.remindingSince = now;
            fx.push(...this.remindEffects());
          }
        }
        break;

      case PHASE.REMINDING:
        // Standing up and walking away after being reminded = break taken, no button
        // press required.
        if (idleSecs >= this.idleThresholdSecs()) {
          this.phase = PHASE.IDLE;
          fx.push({ type: 'closeReminder' });
        } else if (now - this.remindingSince >= IGNORED_RENAG_SECS * 1000) {
          // Still at the machine but ignoring the reminder for too long: do not get
          // stuck in 'reminding' (which would stay silent forever). Treat it like
          // pressing "Snooze" — put the window away and remind again in a few
          // minutes. One exception: a TEST reminder fired while paused (pauseUntil is
          // still set) goes back to paused, exactly like skip() — never quietly
          // resume behind the user's back.
          fx.push({ type: 'closeReminder' });
          if (this.pauseUntil !== undefined) {
            this.phase = PHASE.PAUSED;
          } else {
            this.phase = PHASE.WORKING;
            this.deadline = now + SNOOZE_MINS * 60_000;
          }
        }
        break;

      case PHASE.BREAKING:
        if (now >= this.deadline) {
          this.newCycle(now);
          const m = BREAK_OVER_MESSAGES[this.breakMsgIndex % BREAK_OVER_MESSAGES.length];
          this.breakMsgIndex += 1;
          fx.push(
            { type: 'closeReminder' },
            { type: 'closeOverlay' },
            { type: 'notify', title: m.title, body: m.body },
          );
          if (this.settings.sound) fx.push({ type: 'sound', kind: 'breakOver' });
        }
        break;

      case PHASE.IDLE:
        if (idleSecs <= BACK_ACTIVE_SECS) {
          this.newCycle(now); // back at the machine → new cycle, no questions asked
        }
        break;

      case PHASE.PAUSED:
        if (this.pauseUntil != null && now >= this.pauseUntil) {
          this.newCycle(now);
        }
        break;
    }
    return fx;
  }

  remindEffects() {
    const m = REMIND_MESSAGES[this.remindMsgIndex % REMIND_MESSAGES.length];
    this.remindMsgIndex += 1;
    this.message = {
      title: m.title,
      body: m.body.replace('{mins}', String(this.settings.intervalMins)),
    };
    // Do NOT fire a Windows toast when reminding: the reminder window (openReminder)
    // already shows this exact text, so a toast would announce the same thing twice
    // at once. The window also beats a toast in having action buttons and in not
    // being silently suppressed by Windows. Toasts are kept only for the END OF A
    // BREAK (where no other window announces it) and for onboarding.
    return [
      { type: 'openReminder' },
      ...(this.settings.sound ? [{ type: 'sound', kind: 'remind' }] : []),
    ];
  }

  // ---- User actions ----

  // The three methods below all clear pauseUntil: they correspond to the user
  // DELIBERATELY responding to a reminder (break / snooze), so any earlier paused
  // state is considered dropped. skip() is the exception — see the note there.
  // Each break takes the next stretch from the set.
  pickStretch() {
    this.stretch = STRETCH_IDEAS[this.stretchIndex % STRETCH_IDEAS.length];
    this.stretchIndex += 1;
  }

  takeBreak(now) {
    if (this.phase !== PHASE.REMINDING) return [];
    this.phase = PHASE.BREAKING;
    this.deadline = now + this.breakMs();
    this.pauseUntil = undefined;
    this.pickStretch();
    // Overlay on: it takes over the whole screen, so put the small reminder window
    // away or two windows would be counting down the same break. Overlay off: keep
    // the old behaviour — the reminder window switches to its break-countdown face
    // by itself, no effect needed.
    return this.settings.breakOverlay
      ? [{ type: 'closeReminder' }, { type: 'openOverlay' }]
      : [];
  }

  snooze(now) {
    if (this.phase !== PHASE.REMINDING) return [];
    this.phase = PHASE.WORKING;
    this.deadline = now + SNOOZE_MINS * 60_000;
    this.pauseUntil = undefined;
    return [{ type: 'closeReminder' }];
  }

  skip(now) {
    if (this.phase !== PHASE.REMINDING && this.phase !== PHASE.BREAKING) return [];
    // "Skip" means put the reminder away and change nothing else. If this reminder
    // was a TEST fired while the app was paused (pauseUntil is still intact, because
    // triggerReminder does not touch it), we must return the app to that paused
    // state — never quietly start running again behind the user's back.
    if (this.pauseUntil !== undefined) {
      this.phase = PHASE.PAUSED;
      return [{ type: 'closeReminder' }, { type: 'closeOverlay' }];
    }
    this.newCycle(now);
    return [{ type: 'closeReminder' }, { type: 'closeOverlay' }];
  }

  breakNow(now) {
    this.phase = PHASE.BREAKING;
    this.deadline = now + this.breakMs();
    this.pauseUntil = undefined;
    this.pickStretch();
    return this.settings.breakOverlay
      ? [{ type: 'openOverlay' }]
      : [{ type: 'openReminder' }];
  }

  // "Test reminder" is a TEST: it must not damage the current state. Leave
  // pauseUntil intact so skip() knows to put the app back into its paused state.
  triggerReminder(now) {
    this.phase = PHASE.REMINDING;
    this.remindingSince = now;
    return this.remindEffects();
  }

  pause(now, mins) {
    const fx = [];
    if (this.phase === PHASE.REMINDING || this.phase === PHASE.BREAKING) {
      fx.push({ type: 'closeReminder' }, { type: 'closeOverlay' });
    }
    this.phase = PHASE.PAUSED;
    this.pauseSpanMs = mins == null ? undefined : mins * 60_000;
    this.pauseUntil = mins == null ? null : now + this.pauseSpanMs;
    return fx;
  }

  resume(now) {
    if (this.phase === PHASE.PAUSED) this.newCycle(now);
    return [];
  }

  // Apply new settings immediately, but never let a running deadline outlast the
  // duration just chosen: shortening the interval 45→30, or the break 10→2, while
  // keeping the old deadline makes the app look frozen on the old number.
  updateSettings(now, settings) {
    this.settings = { ...settings };
    if (this.phase === PHASE.WORKING || this.phase === PHASE.BREAKING) {
      const span = this.phase === PHASE.BREAKING ? this.breakMs() : this.intervalMs();
      const maxDeadline = now + span;
      if (this.deadline > maxDeadline) this.deadline = maxDeadline;
    }
  }
}

module.exports = {
  Engine, PHASE, SNOOZE_MINS, IGNORED_RENAG_SECS, DEFAULT_SETTINGS, clampSettings,
  REMIND_MESSAGES, BREAK_OVER_MESSAGES, REMINDER_POSITIONS, STRETCH_IDEAS,
};
