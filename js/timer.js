/* ==========================================================
   timer.js — Server-synchronised countdown
   The deadline (endTime) is a SERVER timestamp. The remaining
   time is recomputed from the clock on every tick, so refreshing,
   throttled background tabs or sleeping phones never drift.
   ========================================================== */
(function () {
  'use strict';

  class Countdown {
    /**
     * @param {object} o
     * @param {number} o.endTime          server deadline (ms since epoch)
     * @param {function} o.now            returns the server-corrected "now" in ms
     * @param {function} o.onTick         (remainingSeconds)
     * @param {function} o.onWarn         fired once when <= warnAt
     * @param {function} o.onDanger       fired once when <= dangerAt
     * @param {function} o.onEnd          fired once at zero
     */
    constructor(o) {
      this.endTime = o.endTime;
      this.now = o.now;
      this.onTick = o.onTick || function () {};
      this.onWarn = o.onWarn || function () {};
      this.onDanger = o.onDanger || function () {};
      this.onEnd = o.onEnd || function () {};
      this.warnAt = o.warnAt;
      this.dangerAt = o.dangerAt;
      this._id = null;
      this._fired = { warn: false, danger: false, end: false };
      this._visHandler = this.tick.bind(this);
    }

    remaining() {
      return Math.max(0, Math.ceil((this.endTime - this.now()) / 1000));
    }

    start() {
      this.stop();
      this.tick();
      this._id = setInterval(this.tick.bind(this), 250);
      document.addEventListener('visibilitychange', this._visHandler);
      window.addEventListener('focus', this._visHandler);
    }

    stop() {
      if (this._id) clearInterval(this._id);
      this._id = null;
      document.removeEventListener('visibilitychange', this._visHandler);
      window.removeEventListener('focus', this._visHandler);
    }

    tick() {
      const r = this.remaining();
      this.onTick(r);
      if (r <= this.dangerAt && !this._fired.danger) { this._fired.danger = true; this._fired.warn = true; this.onDanger(r); }
      else if (r <= this.warnAt && !this._fired.warn) { this._fired.warn = true; this.onWarn(r); }
      if (r <= 0 && !this._fired.end) { this._fired.end = true; this.stop(); this.onEnd(); }
    }
  }

  /** 1800 -> "30:00" */
  function formatMMSS(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  window.VireloTimer = { Countdown: Countdown, formatMMSS: formatMMSS };
})();
