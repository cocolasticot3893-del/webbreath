/**
 * Contrôleur de cadence respiratoire 60 fps (`BreathPacer`) et chronomètre BOLT/Apnée (`BoltChrono`).
 * Module ES2024+ zéro-build utilisant `requestAnimationFrame` et WebAudio API sans fichiers externes.
 */

const PHASE_META = Object.freeze({
  inhale: { label: "Inspirer", key: "inhale_s", freqHz: 330, endFreqHz: 440, targetScale: 1.0 },
  hold_in: { label: "Maintien plein", key: "hold_in_s", freqHz: 440, endFreqHz: 440, targetScale: 1.0 },
  exhale: { label: "Expirer", key: "exhale_s", freqHz: 392, endFreqHz: 220, targetScale: 0.42 },
  hold_out: { label: "Pause vide", key: "hold_out_s", freqHz: 220, endFreqHz: 220, targetScale: 0.42 },
});

const PHASE_ORDER = ["inhale", "hold_in", "exhale", "hold_out"];

/**
 * Normalise un pattern respiratoire en secondes (>= 0).
 * @param {Record<string, unknown> | null | undefined} pattern
 * @returns {{ inhale_s: number, hold_in_s: number, exhale_s: number, hold_out_s: number }}
 */
export function normalizePacerPattern(pattern) {
  const src = pattern && typeof pattern === "object" ? pattern : {};
  const toPos = (val, fallback) => {
    const num = Number(val);
    return Number.isFinite(num) && num >= 0 ? num : fallback;
  };
  const inhale_s = Math.max(0.4, toPos(src.inhale_s, 4.0));
  const hold_in_s = toPos(src.hold_in_s, 0);
  const exhale_s = Math.max(0.4, toPos(src.exhale_s, 6.0));
  const hold_out_s = toPos(src.hold_out_s, 0);
  return { inhale_s, hold_in_s, exhale_s, hold_out_s };
}

/**
 * Synthétiseur WebAudio minimaliste (oscillateur sine/triangle doux 220-440 Hz).
 */
class BreathAudioCue {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    this.muted = false;
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  /** @returns {AudioContext | null} */
  ensureContext() {
    if (this.muted) return null;
    const AudioCtx =
      typeof globalThis.AudioContext === "function"
        ? globalThis.AudioContext
        : typeof globalThis.webkitAudioContext === "function"
          ? globalThis.webkitAudioContext
          : null;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Joue un signal sonore doux à la transition de phase ou de fin de série.
   * @param {"inhale" | "hold_in" | "exhale" | "hold_out" | "complete"} phase
   */
  playCue(phase) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (phase === "complete") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
      return;
    }

    const meta = PHASE_META[phase] ?? PHASE_META.inhale;
    const isHold = phase === "hold_in" || phase === "hold_out";
    osc.type = isHold ? "triangle" : "sine";
    osc.frequency.setValueAtTime(meta.freqHz, now);
    if (meta.endFreqHz !== meta.freqHz) {
      osc.frequency.exponentialRampToValueAtTime(meta.endFreqHz, now + 0.22);
    }

    const peakGain = isHold ? 0.035 : 0.065;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }
}

/**
 * Contrôleur 60 fps du Pacer respiratoire SVG.
 */
export class BreathPacer {
  /**
   * @param {object} elements
   * @param {SVGCircleElement | null} [elements.ringProgressEl]
   * @param {HTMLElement | null} [elements.orbEl]
   * @param {HTMLElement | null} [elements.phaseLabelEl]
   * @param {HTMLElement | null} [elements.phaseTimerEl]
   * @param {HTMLElement | null} [elements.repCounterEl]
   * @param {HTMLElement | null} [elements.setCounterEl]
   * @param {HTMLElement | null} [elements.exerciseNameEl]
   * @param {HTMLElement | null} [elements.patternBadgeEl]
   * @param {HTMLElement | null} [elements.containerEl]
   * @param {(info: object) => void} [elements.onSetComplete]
   * @param {(info: object) => void} [elements.onSessionComplete]
   * @param {(state: object) => void} [elements.onStateChange]
   */
  constructor(elements = {}) {
    this.el = elements;
    this.audio = new BreathAudioCue();

    this.ringRadius = 86;
    this.ringCircumference = 2 * Math.PI * this.ringRadius;
    if (this.el.ringProgressEl) {
      this.el.ringProgressEl.style.strokeDasharray = `${this.ringCircumference.toFixed(2)}`;
      this.el.ringProgressEl.style.strokeDashoffset = `${this.ringCircumference.toFixed(2)}`;
    }

    this.pattern = normalizePacerPattern(null);
    this.exerciseId = "";
    this.exerciseName = "Résonance Vagale 0,1 Hz";
    this.targetSets = 1;
    this.targetReps = 10;
    this.isTimed = false;
    this.restSeconds = 45;

    this.running = false;
    this.paused = false;
    this.currentSet = 1;
    this.currentRep = 1;
    this.phaseIndex = 0;
    this.phaseElapsedMs = 0;
    this.setElapsedMs = 0;
    this.lastFrameMs = 0;
    this.rafId = 0;
    this.inRest = false;
    this.restRemainingMs = 0;

    this.renderIdle();
  }

  /**
   * Charge un exercice et son pattern respiratoire dans le Pacer.
   * @param {object} config
   */
  loadExercise(config = {}) {
    this.stop(false);
    this.exerciseId = String(config.id ?? "");
    this.exerciseName = String(config.name ?? "Cycle Respiratoire");
    this.pattern = normalizePacerPattern(config.pacer_pattern);
    this.isTimed = Boolean(config.is_timed);
    this.targetSets = Math.max(1, Math.round(Number(config.sets) || 1));

    const cycleSec =
      this.pattern.inhale_s +
      this.pattern.hold_in_s +
      this.pattern.exhale_s +
      this.pattern.hold_out_s;

    if (this.isTimed) {
      const targetSec = Math.max(10, Math.round(Number(config.reps) || 60));
      this.targetDurationSec = targetSec;
      this.targetReps = Math.max(1, Math.round(targetSec / Math.max(1, cycleSec)));
    } else {
      this.targetReps = Math.max(1, Math.round(Number(config.reps) || 10));
      this.targetDurationSec = Math.round(this.targetReps * cycleSec);
    }

    this.restSeconds = Math.max(10, Math.round(Number(config.restSeconds) || 45));
    this.currentSet = 1;
    this.currentRep = 1;
    this.renderIdle();
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    this.audio.setMuted(muted);
  }

  /** @returns {boolean} */
  isMuted() {
    return this.audio.muted;
  }

  start() {
    if (this.running && !this.paused) return;
    this.audio.ensureContext();

    if (!this.running) {
      this.running = true;
      this.paused = false;
      this.inRest = false;
      this.currentSet = 1;
      this.currentRep = 1;
      this.phaseIndex = this.findFirstActivePhaseIndex(0);
      this.phaseElapsedMs = 0;
      this.setElapsedMs = 0;
      const startPhase = PHASE_ORDER[this.phaseIndex];
      this.audio.playCue(startPhase);
    } else {
      this.paused = false;
    }

    this.lastFrameMs = performance.now();
    this.emitState();
    this.scheduleTick();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.emitState();
  }

  toggle() {
    if (this.running && !this.paused) {
      this.pause();
    } else {
      this.start();
    }
  }

  /** @param {boolean} [emit=true] */
  stop(emit = true) {
    this.running = false;
    this.paused = false;
    this.inRest = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.currentSet = 1;
    this.currentRep = 1;
    this.phaseIndex = 0;
    this.phaseElapsedMs = 0;
    this.setElapsedMs = 0;
    this.renderIdle();
    if (emit) this.emitState();
  }

  nextPhaseIndex(fromIdx) {
    return this.findFirstActivePhaseIndex((fromIdx + 1) % PHASE_ORDER.length);
  }

  findFirstActivePhaseIndex(startIdx) {
    for (let i = 0; i < PHASE_ORDER.length; i += 1) {
      const idx = (startIdx + i) % PHASE_ORDER.length;
      const key = PHASE_META[PHASE_ORDER[idx]].key;
      if (this.pattern[key] > 0) return idx;
    }
    return 0;
  }

  scheduleTick() {
    if (!this.running || this.paused) return;
    this.rafId = requestAnimationFrame((now) => this.tick(now));
  }

  /** @param {number} now */
  tick(now) {
    if (!this.running || this.paused) return;
    const dt = Math.min(100, Math.max(0, now - this.lastFrameMs));
    this.lastFrameMs = now;

    if (this.inRest) {
      this.restRemainingMs -= dt;
      if (this.restRemainingMs <= 0) {
        this.inRest = false;
        this.currentSet += 1;
        this.currentRep = 1;
        this.setElapsedMs = 0;
        this.phaseIndex = this.findFirstActivePhaseIndex(0);
        this.phaseElapsedMs = 0;
        this.audio.playCue(PHASE_ORDER[this.phaseIndex]);
      } else {
        this.renderRest(this.restRemainingMs / 1000);
        this.scheduleTick();
        return;
      }
    }

    this.setElapsedMs += dt;
    this.phaseElapsedMs += dt;

    let safetyLoop = 0;
    while (safetyLoop < 8) {
      safetyLoop += 1;
      const phaseName = PHASE_ORDER[this.phaseIndex];
      const phaseDurationMs = this.pattern[PHASE_META[phaseName].key] * 1000;
      if (phaseDurationMs <= 0 || this.phaseElapsedMs >= phaseDurationMs) {
        this.phaseElapsedMs = Math.max(0, this.phaseElapsedMs - phaseDurationMs);
        const prevIdx = this.phaseIndex;
        const nextIdx = this.nextPhaseIndex(prevIdx);
        this.phaseIndex = nextIdx;

        if (nextIdx <= prevIdx) {
          this.currentRep += 1;
          const setDone = this.isTimed
            ? this.setElapsedMs >= this.targetDurationSec * 1000
            : this.currentRep > this.targetReps;

          if (setDone) {
            this.handleSetCompletion();
            return;
          }
        }
        this.audio.playCue(PHASE_ORDER[this.phaseIndex]);
      } else {
        break;
      }
    }

    const phaseName = PHASE_ORDER[this.phaseIndex];
    const phaseDurationMs = Math.max(100, this.pattern[PHASE_META[phaseName].key] * 1000);
    const progress = Math.min(1, Math.max(0, this.phaseElapsedMs / phaseDurationMs));
    const remainingSec = Math.max(0, (phaseDurationMs - this.phaseElapsedMs) / 1000);

    this.renderFrame(phaseName, progress, remainingSec);
    this.scheduleTick();
  }

  handleSetCompletion() {
    this.audio.playCue("complete");
    if (typeof this.el.onSetComplete === "function") {
      this.el.onSetComplete({
        exerciseId: this.exerciseId,
        completedSet: this.currentSet,
        targetSets: this.targetSets,
      });
    }

    if (this.currentSet >= this.targetSets) {
      this.running = false;
      this.paused = false;
      this.renderDone();
      this.emitState();
      if (typeof this.el.onSessionComplete === "function") {
        this.el.onSessionComplete({
          exerciseId: this.exerciseId,
          targetSets: this.targetSets,
        });
      }
      return;
    }

    this.inRest = true;
    this.restRemainingMs = this.restSeconds * 1000;
    this.renderRest(this.restSeconds);
    this.emitState();
    this.scheduleTick();
  }

  renderIdle() {
    const p = this.pattern;
    if (this.el.exerciseNameEl) {
      this.el.exerciseNameEl.textContent = this.exerciseName;
    }
    if (this.el.patternBadgeEl) {
      this.el.patternBadgeEl.textContent = `${p.inhale_s}s / ${p.hold_in_s}s / ${p.exhale_s}s / ${p.hold_out_s}s`;
    }
    if (this.el.phaseLabelEl) {
      this.el.phaseLabelEl.textContent = "Prêt";
    }
    if (this.el.phaseTimerEl) {
      this.el.phaseTimerEl.textContent = `${p.inhale_s.toFixed(1)} s`;
    }
    if (this.el.repCounterEl) {
      this.el.repCounterEl.textContent = this.isTimed
        ? `0 / ${this.targetDurationSec ?? 60} s`
        : `0 / ${this.targetReps} reps`;
    }
    if (this.el.setCounterEl) {
      this.el.setCounterEl.textContent = `Série 1 / ${this.targetSets}`;
    }
    if (this.el.orbEl) {
      this.el.orbEl.style.transform = "scale(0.55)";
    }
    if (this.el.ringProgressEl) {
      this.el.ringProgressEl.style.strokeDashoffset = `${this.ringCircumference.toFixed(2)}`;
    }
    if (this.el.containerEl) {
      this.el.containerEl.dataset.phase = "idle";
    }
  }

  /**
   * @param {"inhale" | "hold_in" | "exhale" | "hold_out"} phaseName
   * @param {number} progress
   * @param {number} remainingSec
   */
  renderFrame(phaseName, progress, remainingSec) {
    const meta = PHASE_META[phaseName] ?? PHASE_META.inhale;

    if (this.el.containerEl) {
      this.el.containerEl.dataset.phase = phaseName;
    }
    if (this.el.phaseLabelEl) {
      this.el.phaseLabelEl.textContent = meta.label;
    }
    if (this.el.phaseTimerEl) {
      this.el.phaseTimerEl.textContent = `${remainingSec.toFixed(1)} s`;
    }
    if (this.el.setCounterEl) {
      this.el.setCounterEl.textContent = `Série ${this.currentSet} / ${this.targetSets}`;
    }
    if (this.el.repCounterEl) {
      if (this.isTimed) {
        const elapsedS = Math.min(this.targetDurationSec, Math.floor(this.setElapsedMs / 1000));
        this.el.repCounterEl.textContent = `${elapsedS} / ${this.targetDurationSec} s`;
      } else {
        this.el.repCounterEl.textContent = `Cycle ${Math.min(this.currentRep, this.targetReps)} / ${this.targetReps}`;
      }
    }

    let scale = 0.45;
    if (phaseName === "inhale") {
      const eased = 1 - Math.pow(1 - progress, 2.2);
      scale = 0.42 + (1.0 - 0.42) * eased;
    } else if (phaseName === "hold_in") {
      scale = 1.0;
    } else if (phaseName === "exhale") {
      const eased = Math.pow(progress, 1.35);
      scale = 1.0 - (1.0 - 0.42) * eased;
    } else {
      scale = 0.42;
    }

    if (this.el.orbEl) {
      this.el.orbEl.style.transform = `scale(${scale.toFixed(3)})`;
    }
    if (this.el.ringProgressEl) {
      const offset = this.ringCircumference * (1 - progress);
      this.el.ringProgressEl.style.strokeDashoffset = `${offset.toFixed(2)}`;
    }
  }

  /** @param {number} remainingSec */
  renderRest(remainingSec) {
    if (this.el.containerEl) {
      this.el.containerEl.dataset.phase = "rest";
    }
    if (this.el.phaseLabelEl) {
      this.el.phaseLabelEl.textContent = "Récupération nasale";
    }
    if (this.el.phaseTimerEl) {
      this.el.phaseTimerEl.textContent = `${Math.max(0, remainingSec).toFixed(0)} s`;
    }
    if (this.el.orbEl) {
      this.el.orbEl.style.transform = "scale(0.55)";
    }
    if (this.el.ringProgressEl) {
      const ratio = Math.max(0, Math.min(1, remainingSec / this.restSeconds));
      const offset = this.ringCircumference * (1 - ratio);
      this.el.ringProgressEl.style.strokeDashoffset = `${offset.toFixed(2)}`;
    }
  }

  renderDone() {
    if (this.el.containerEl) {
      this.el.containerEl.dataset.phase = "done";
    }
    if (this.el.phaseLabelEl) {
      this.el.phaseLabelEl.textContent = "Bloc validé";
    }
    if (this.el.phaseTimerEl) {
      this.el.phaseTimerEl.textContent = "✓";
    }
    if (this.el.ringProgressEl) {
      this.el.ringProgressEl.style.strokeDashoffset = "0";
    }
  }

  emitState() {
    if (typeof this.el.onStateChange === "function") {
      this.el.onStateChange({
        running: this.running,
        paused: this.paused,
        inRest: this.inRest,
        currentSet: this.currentSet,
        targetSets: this.targetSets,
      });
    }
  }
}

/**
 * Chronomètre 1-tap pour Test BOLT (Body Oxygen Level Test) & Tolérance CO₂ / Apnée.
 */
export class BoltChrono {
  /**
   * @param {object} options
   * @param {HTMLElement | null} [options.displayEl]
   * @param {HTMLElement | null} [options.hintEl]
   * @param {HTMLButtonElement | null} [options.toggleBtn]
   * @param {HTMLButtonElement | null} [options.saveBtn]
   * @param {(boltSec: number) => void} [options.onSave]
   * @param {(running: boolean, elapsedSec: number) => void} [options.onTick]
   */
  constructor(options = {}) {
    this.displayEl = options.displayEl ?? null;
    this.hintEl = options.hintEl ?? null;
    this.toggleBtn = options.toggleBtn ?? null;
    this.saveBtn = options.saveBtn ?? null;
    this.onSave = options.onSave ?? null;
    this.onTick = options.onTick ?? null;

    this.running = false;
    this.startMs = 0;
    this.lastSeconds = 0;
    this.rafId = 0;
    this.renderDisplay(0);
  }

  toggle() {
    if (this.running) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startMs = performance.now();
    this.lastSeconds = 0;
    if (this.toggleBtn) {
      this.toggleBtn.textContent = "■ Stopper BOLT";
      this.toggleBtn.classList.add("is-recording");
    }
    if (this.saveBtn) {
      this.saveBtn.disabled = true;
    }
    if (this.hintEl) {
      this.hintEl.textContent =
        "Apnée post-expiration calme : stopper au premier réflexe diaphragmatique (SpO₂ ≥ 88 %).";
    }
    this.loop();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    const elapsedSec = Math.round(((performance.now() - this.startMs) / 1000) * 10) / 10;
    this.lastSeconds = Math.max(0.5, elapsedSec);
    this.renderDisplay(this.lastSeconds);
    this.updateZoneHint(this.lastSeconds);

    if (this.toggleBtn) {
      this.toggleBtn.textContent = "▶ Démarrer BOLT";
      this.toggleBtn.classList.remove("is-recording");
    }
    if (this.saveBtn) {
      this.saveBtn.disabled = false;
    }
  }

  save() {
    if (this.running) {
      this.stop();
    }
    if (this.lastSeconds > 0 && typeof this.onSave === "function") {
      this.onSave(Math.round(this.lastSeconds));
    }
  }

  loop() {
    if (!this.running) return;
    const elapsedSec = (performance.now() - this.startMs) / 1000;
    this.lastSeconds = elapsedSec;
    this.renderDisplay(elapsedSec);
    if (typeof this.onTick === "function") {
      this.onTick(true, elapsedSec);
    }
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  /** @param {number} seconds */
  renderDisplay(seconds) {
    if (this.displayEl) {
      this.displayEl.textContent = `${seconds.toFixed(1)} s`;
    }
  }

  /** @param {number} sec */
  updateZoneHint(sec) {
    if (!this.hintEl) return;
    if (sec < 15) {
      this.hintEl.textContent = `BOLT ${sec.toFixed(1)} s (< 15 s) : sensibilité CO₂ élevée — privilégier résonance vagale 0,1 Hz & SpO₂ ≥ 88 %.`;
    } else if (sec < 25) {
      this.hintEl.textContent = `BOLT ${sec.toFixed(1)} s (15-25 s) : tolérance CO₂ modérée — apnées de récupération nasale adaptées (SpO₂ ≥ 88 %).`;
    } else if (sec < 40) {
      this.hintEl.textContent = `BOLT ${sec.toFixed(1)} s (25-40 s) : bonne efficacité chimioréceptrice (plancher SpO₂ ≥ 88 %).`;
    } else {
      this.hintEl.textContent = `BOLT ${sec.toFixed(1)} s (≥ 40 s) : excellente tolérance CO₂ — maintenir la surveillance SpO₂ ≥ 88 %.`;
    }
  }
}
