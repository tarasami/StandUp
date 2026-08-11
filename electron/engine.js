// Engine — state machine thuần của StandUp, không phụ thuộc Electron (unit-test được).
//
// Trạng thái:
//   working   — đang trong chu kỳ ngồi làm việc, đếm tới deadline
//   reminding — đã tới giờ, cửa sổ nhắc đang mở, chờ người dùng hành động
//   breaking  — đang nghỉ, đếm tới hết giờ nghỉ
//   idle      — người dùng rời máy (coi như đang nghỉ tự nhiên)
//   paused    — người dùng chủ động tạm dừng
//
// Mọi thời gian là epoch milliseconds (wall-clock tuyệt đối) để sống sót qua
// sleep/hibernate: máy ngủ đủ lâu = coi như đã nghỉ, bắt đầu chu kỳ mới.

const PHASE = {
  WORKING: 'working',
  REMINDING: 'reminding',
  BREAKING: 'breaking',
  IDLE: 'idle',
  PAUSED: 'paused',
};

const DEFAULT_SETTINGS = {
  intervalMins: 45,
  breakMins: 5,
  idleMins: 5,
  sound: true,
  autoStart: true,
  onboarded: false,
};

// Làm sạch cài đặt đến từ renderer hoặc file JSON trên đĩa: cả hai đều có thể
// chứa giá trị rác (chuỗi rỗng, NaN, âm, file bị sửa tay). Giá trị ngoài khoảng
// bị kẹp về biên; giá trị không phải số rơi về mặc định.
function clampSettings(raw) {
  const num = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
  return {
    intervalMins: num(raw?.intervalMins, 5, 240, DEFAULT_SETTINGS.intervalMins),
    breakMins: num(raw?.breakMins, 1, 60, DEFAULT_SETTINGS.breakMins),
    idleMins: num(raw?.idleMins, 1, 60, DEFAULT_SETTINGS.idleMins),
    sound: bool(raw?.sound, DEFAULT_SETTINGS.sound),
    autoStart: bool(raw?.autoStart, DEFAULT_SETTINGS.autoStart),
    onboarded: bool(raw?.onboarded, DEFAULT_SETTINGS.onboarded),
  };
}

// Lời nhắc xoay vòng. Nghe mãi một câu là công tắc tắt app nhanh nhất —
// giọng thân thiện, không ra lệnh, không phán xét. {mins} = số phút đã ngồi.
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

const SNOOZE_MINS = 5;
// Khoảng trống giữa 2 tick vượt mức này nghĩa là máy vừa sleep/hibernate
// (tick bình thường cách nhau 1 giây).
const SLEEP_GAP_SECS = 90;
// Idle tụt xuống dưới mức này nghĩa là người dùng đã quay lại máy.
const BACK_ACTIVE_SECS = 3;

class Engine {
  constructor(settings, now) {
    this.settings = { ...settings };
    this.phase = PHASE.WORKING;
    this.deadline = now + this.intervalMs();
    this.pauseUntil = undefined; // number = hẹn giờ, null = đến khi bật lại
    this.lastTick = now;
    // Xoay vòng tuần tự (không random) để không bao giờ lặp câu trước khi
    // dùng hết bộ — vừa dễ test, vừa đỡ nhàm hơn random thật.
    this.remindMsgIndex = 0;
    this.breakMsgIndex = 0;
    this.message = null; // lời nhắc đang hiển thị, để cửa sổ nhắc dùng chung
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

  // Đồng hồ hệ thống bị chỉnh LÙI (NTP sync, người dùng đổi giờ/múi giờ) sẽ đẩy
  // deadline ra xa hơn cả một chu kỳ đầy đủ → app im lặng vô thời hạn. Không thể
  // biết thực sự đã ngồi bao lâu, nên kéo deadline về đúng một chu kỳ tính từ bây giờ.
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
    };
  }

  // Gọi mỗi ~1 giây. Trả về danh sách effect cho tầng ngoài thực thi:
  //   {type:'openReminder'} | {type:'closeReminder'} | {type:'notify', title, body}
  tick(now, idleSecs) {
    const fx = [];
    const gapSecs = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (gapSecs < 0) this.rebaseIfClockWentBack(now);

    // Máy sleep/hibernate đủ lâu = người dùng đã rời máy = đã nghỉ.
    if (gapSecs >= SLEEP_GAP_SECS && gapSecs >= this.idleThresholdSecs() && this.phase !== PHASE.PAUSED) {
      if (this.phase === PHASE.REMINDING || this.phase === PHASE.BREAKING) {
        fx.push({ type: 'closeReminder' });
      }
      this.newCycle(now);
      return fx;
    }

    switch (this.phase) {
      case PHASE.WORKING:
        if (idleSecs >= this.idleThresholdSecs()) {
          this.phase = PHASE.IDLE;
        } else if (now >= this.deadline) {
          this.phase = PHASE.REMINDING;
          fx.push(...this.remindEffects());
        }
        break;

      case PHASE.REMINDING:
        // Đứng dậy bỏ đi sau khi được nhắc = đã nghỉ, không cần bấm gì cả.
        if (idleSecs >= this.idleThresholdSecs()) {
          this.phase = PHASE.IDLE;
          fx.push({ type: 'closeReminder' });
        }
        break;

      case PHASE.BREAKING:
        if (now >= this.deadline) {
          this.newCycle(now);
          const m = BREAK_OVER_MESSAGES[this.breakMsgIndex % BREAK_OVER_MESSAGES.length];
          this.breakMsgIndex += 1;
          fx.push(
            { type: 'closeReminder' },
            { type: 'notify', title: m.title, body: m.body },
          );
          if (this.settings.sound) fx.push({ type: 'sound', kind: 'breakOver' });
        }
        break;

      case PHASE.IDLE:
        if (idleSecs <= BACK_ACTIVE_SECS) {
          this.newCycle(now); // quay lại máy → chu kỳ mới, không hỏi han gì
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
    return [
      { type: 'openReminder' },
      { type: 'notify', title: this.message.title, body: this.message.body },
      ...(this.settings.sound ? [{ type: 'sound', kind: 'remind' }] : []),
    ];
  }

  // ---- Hành động từ người dùng ----

  takeBreak(now) {
    if (this.phase !== PHASE.REMINDING) return [];
    this.phase = PHASE.BREAKING;
    this.deadline = now + this.breakMs();
    return []; // cửa sổ nhắc giữ nguyên, tự chuyển sang giao diện đếm giờ nghỉ
  }

  snooze(now) {
    if (this.phase !== PHASE.REMINDING) return [];
    this.phase = PHASE.WORKING;
    this.deadline = now + SNOOZE_MINS * 60_000;
    return [{ type: 'closeReminder' }];
  }

  skip(now) {
    if (this.phase !== PHASE.REMINDING && this.phase !== PHASE.BREAKING) return [];
    this.newCycle(now);
    return [{ type: 'closeReminder' }];
  }

  breakNow(now) {
    this.phase = PHASE.BREAKING;
    this.deadline = now + this.breakMs();
    this.pauseUntil = undefined;
    return [{ type: 'openReminder' }];
  }

  triggerReminder() {
    this.phase = PHASE.REMINDING;
    this.pauseUntil = undefined;
    return this.remindEffects();
  }

  pause(now, mins) {
    const fx = [];
    if (this.phase === PHASE.REMINDING || this.phase === PHASE.BREAKING) {
      fx.push({ type: 'closeReminder' });
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

  // Áp dụng cài đặt mới ngay, nhưng không để mốc đang chạy dài hơn thời lượng
  // vừa đặt: rút interval 45→30 hoặc thời gian nghỉ 10→2 mà mốc cũ vẫn giữ
  // nguyên thì người dùng thấy app như bị treo ở con số cũ.
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
  Engine, PHASE, SNOOZE_MINS, DEFAULT_SETTINGS, clampSettings,
  REMIND_MESSAGES, BREAK_OVER_MESSAGES,
};
