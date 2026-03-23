import { equalPowerCrossfade } from "./crossfade";

const SMOOTH_TC = 0.035;
const METER_FFT = 2048;
const METER_SMOOTH = 0.88;
const SCRUB_SEGMENT_SEC = 0.11;
const SCRUB_RESTART_MIN_SEC = 0.026;
const SCRUB_DEAD_ZONE = 0.035;
const SCRUB_PLAYHEAD_SPEED = 1.6;
const SCRUB_INPUT_SMOOTH_TAU = 0.085;
const MIN_RATE = 0.2;
const MAX_RATE = 3;
const MIN_REVERSE_RATE = -2;
const MAX_REVERSE_RATE = -0.25;

type Deck = "a" | "b";
type DeckMode = "normal" | "scrub";

type DeckTransport = {
  playheadSec: number;
  targetRate: number;
  scrubVelocity: number;
  scrubVelocitySmooth: number;
  scrubRestartAccumSec: number;
  scrubSessionActive: boolean;
  scrubAnchorSec: number;
  scrubCommittedSec: number;
  mode: DeckMode;
  lastTickCtxSec: number;
  sourceStartCtxSec: number;
  sourceStartOffsetSec: number;
  sourceRate: number;
  sourceSegmentSec: number;
};

/**
 * Two-deck Web Audio graph: buffer sources (loop) → per-deck gain → light compressor → destination.
 * Levels follow mapper.smooth: effective gain = deckGain × equal-power crossfader pan.
 * Per-deck transport: each deck can play or pause independently. Analysers tap post-fader gains for meters.
 */
export class DjMixerEngine {
  private ctx: AudioContext | null = null;
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private analyserA: AnalyserNode | null = null;
  private analyserB: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sourceA: AudioBufferSourceNode | null = null;
  private sourceB: AudioBufferSourceNode | null = null;
  private bufferA: AudioBuffer | null = null;
  private bufferB: AudioBuffer | null = null;
  private playingA = false;
  private playingB = false;
  /** Whether `AudioBufferSourceNode` accepts negative `playbackRate` (reverse) in this browser. */
  private reversePlaybackSupported = false;
  private readonly tdA = new Float32Array(METER_FFT);
  private readonly tdB = new Float32Array(METER_FFT);
  private meterSmoothA = 0;
  private meterSmoothB = 0;
  private transportA: DeckTransport = {
    playheadSec: 0,
    targetRate: 1,
    scrubVelocity: 0,
    scrubVelocitySmooth: 0,
    scrubRestartAccumSec: 0,
    scrubSessionActive: false,
    scrubAnchorSec: 0,
    scrubCommittedSec: 0,
    mode: "normal",
    lastTickCtxSec: 0,
    sourceStartCtxSec: 0,
    sourceStartOffsetSec: 0,
    sourceRate: 1,
    sourceSegmentSec: 0,
  };
  private transportB: DeckTransport = {
    playheadSec: 0,
    targetRate: 1,
    scrubVelocity: 0,
    scrubVelocitySmooth: 0,
    scrubRestartAccumSec: 0,
    scrubSessionActive: false,
    scrubAnchorSec: 0,
    scrubCommittedSec: 0,
    mode: "normal",
    lastTickCtxSec: 0,
    sourceStartCtxSec: 0,
    sourceStartOffsetSec: 0,
    sourceRate: 1,
    sourceSegmentSec: 0,
  };

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  /** True if this deck’s buffer source is running (audible path may still be at 0 gain). */
  isDeckPlaying(deck: "a" | "b"): boolean {
    return deck === "a" ? this.sourceA !== null : this.sourceB !== null;
  }

  isAnyDeckPlaying(): boolean {
    return this.sourceA !== null || this.sourceB !== null;
  }

  /**
   * Smoothed peak level 0–1 per deck (post `setLevels` gain tap).
   * Call from rAF while context is running.
   */
  getMeterLevels(): { a: number; b: number } {
    if (!this.analyserA || !this.analyserB) return { a: 0, b: 0 };

    this.analyserA.getFloatTimeDomainData(this.tdA);
    this.analyserB.getFloatTimeDomainData(this.tdB);

    let peakA = 0;
    for (let i = 0; i < this.tdA.length; i++) {
      peakA = Math.max(peakA, Math.abs(this.tdA[i]));
    }
    let peakB = 0;
    for (let i = 0; i < this.tdB.length; i++) {
      peakB = Math.max(peakB, Math.abs(this.tdB[i]));
    }

    this.meterSmoothA = this.meterSmoothA * METER_SMOOTH + peakA * (1 - METER_SMOOTH);
    this.meterSmoothB = this.meterSmoothB * METER_SMOOTH + peakB * (1 - METER_SMOOTH);

    return {
      a: Math.min(1, this.meterSmoothA * 2.2),
      b: Math.min(1, this.meterSmoothB * 2.2),
    };
  }

  private probeReversePlayback(ctx: AudioContext): boolean {
    try {
      const buf = ctx.createBuffer(1, 2, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = -0.5;
      return src.playbackRate.value < 0;
    } catch {
      return false;
    }
  }

  private wireGraph(): void {
    if (!this.ctx || this.gainA) return;
    const c = this.ctx;
    this.gainA = c.createGain();
    this.gainB = c.createGain();
    this.gainA.gain.value = 0;
    this.gainB.gain.value = 0;

    this.analyserA = c.createAnalyser();
    this.analyserB = c.createAnalyser();
    this.analyserA.fftSize = METER_FFT;
    this.analyserB.fftSize = METER_FFT;
    this.analyserA.smoothingTimeConstant = 0.65;
    this.analyserB.smoothingTimeConstant = 0.65;

    this.compressor = c.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.1;

    this.gainA.connect(this.compressor);
    this.gainA.connect(this.analyserA);
    this.gainB.connect(this.compressor);
    this.gainB.connect(this.analyserB);
    this.compressor.connect(c.destination);
  }

  /** Create / resume AudioContext (call from a user gesture). */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.reversePlaybackSupported = this.probeReversePlayback(this.ctx);
      this.wireGraph();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private disconnectSource(s: AudioBufferSourceNode | null): void {
    if (!s) return;
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
    try {
      s.disconnect();
    } catch {
      /* */
    }
  }

  private deckBuffer(deck: Deck): AudioBuffer | null {
    return deck === "a" ? this.bufferA : this.bufferB;
  }

  private deckGain(deck: Deck): GainNode | null {
    return deck === "a" ? this.gainA : this.gainB;
  }

  private deckSource(deck: Deck): AudioBufferSourceNode | null {
    return deck === "a" ? this.sourceA : this.sourceB;
  }

  private setDeckSource(deck: Deck, s: AudioBufferSourceNode | null): void {
    if (deck === "a") this.sourceA = s;
    else this.sourceB = s;
  }

  private deckTransport(deck: Deck): DeckTransport {
    return deck === "a" ? this.transportA : this.transportB;
  }

  private isDeckPlayingFlag(deck: Deck): boolean {
    return deck === "a" ? this.playingA : this.playingB;
  }

  private setDeckPlayingFlag(deck: Deck, v: boolean): void {
    if (deck === "a") this.playingA = v;
    else this.playingB = v;
  }

  private wrapOffset(offset: number, duration: number): number {
    if (!Number.isFinite(offset) || duration <= 0) return 0;
    let out = offset % duration;
    if (out < 0) out += duration;
    return out;
  }

  private normalizeRate(rate: number): number {
    if (rate < 0) {
      if (this.reversePlaybackSupported) return Math.max(MIN_REVERSE_RATE, Math.min(MAX_REVERSE_RATE, rate));
      return 0.35;
    }
    return Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
  }

  private refreshPlayhead(deck: Deck, nowCtxSec: number): void {
    const s = this.deckSource(deck);
    const tr = this.deckTransport(deck);
    const buf = this.deckBuffer(deck);
    if (!s || !buf || buf.duration <= 0) return;
    const elapsed = Math.max(0, nowCtxSec - tr.sourceStartCtxSec);
    const moved = elapsed * tr.sourceRate;
    tr.playheadSec = this.wrapOffset(tr.sourceStartOffsetSec + moved, buf.duration);
  }

  private restartDeckSource(deck: Deck, opts?: { offsetSec?: number; rate?: number; segmentSec?: number }): void {
    if (!this.ctx || !this.gainA || !this.gainB) return;
    const c = this.ctx;
    const buf = this.deckBuffer(deck);
    const gain = this.deckGain(deck);
    if (!buf || !gain || buf.duration <= 0) return;

    this.disconnectSource(this.deckSource(deck));
    this.setDeckSource(deck, null);

    const tr = this.deckTransport(deck);
    const rate = this.normalizeRate(opts?.rate ?? tr.targetRate);
    const offset = this.wrapOffset(opts?.offsetSec ?? tr.playheadSec, buf.duration);
    const segmentSec = opts?.segmentSec ?? 0;
    const shouldLoop = segmentSec <= 0;

    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = shouldLoop;
    s.playbackRate.value = rate;
    s.connect(gain);

    if (shouldLoop) {
      s.start(0, offset);
    } else {
      const remain = Math.max(0.01, Math.min(segmentSec, buf.duration));
      s.start(0, offset, remain);
    }

    this.setDeckSource(deck, s);
    tr.sourceStartCtxSec = c.currentTime;
    tr.sourceStartOffsetSec = offset;
    tr.sourceRate = rate;
    tr.sourceSegmentSec = segmentSec;
    tr.playheadSec = offset;
  }

  /** Decode and store buffer; restarts that deck’s source only if it was playing. */
  async loadDeck(deck: "a" | "b", file: File): Promise<AudioBuffer> {
    const ctx = await this.ensureContext();
    const ab = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    if (deck === "a") {
      this.bufferA = buffer;
      this.transportA.playheadSec = 0;
      this.transportA.targetRate = 1;
      if (this.playingA) this.restartDeckSource("a", { offsetSec: 0, rate: 1 });
    } else {
      this.bufferB = buffer;
      this.transportB.playheadSec = 0;
      this.transportB.targetRate = 1;
      if (this.playingB) this.restartDeckSource("b", { offsetSec: 0, rate: 1 });
    }
    return buffer;
  }

  playDeck(deck: "a" | "b"): void {
    if (!this.ctx || !this.gainA || !this.gainB) return;
    const tr = this.deckTransport(deck);
    tr.mode = "normal";
    tr.targetRate = 1;
    tr.scrubVelocity = 0;
    tr.scrubVelocitySmooth = 0;
    tr.scrubRestartAccumSec = 0;
    tr.scrubSessionActive = false;
    tr.scrubAnchorSec = tr.playheadSec;
    tr.scrubCommittedSec = tr.playheadSec;
    tr.lastTickCtxSec = this.ctx.currentTime;
    this.setDeckPlayingFlag(deck, true);
    this.restartDeckSource(deck, { rate: 1, offsetSec: tr.playheadSec });
  }

  pauseDeck(deck: "a" | "b"): void {
    if (this.ctx) this.refreshPlayhead(deck, this.ctx.currentTime);
    this.setDeckPlayingFlag(deck, false);
    this.disconnectSource(this.deckSource(deck));
    this.setDeckSource(deck, null);
    const tr = this.deckTransport(deck);
    tr.mode = "normal";
    tr.scrubVelocity = 0;
    tr.scrubVelocitySmooth = 0;
    tr.scrubRestartAccumSec = 0;
    tr.scrubSessionActive = false;
    tr.scrubAnchorSec = tr.playheadSec;
    tr.scrubCommittedSec = tr.playheadSec;
  }

  stopAll(): void {
    this.pauseDeck("a");
    this.pauseDeck("b");
    this.transportA.playheadSec = 0;
    this.transportB.playheadSec = 0;
  }

  /**
   * Drive from mapper.smooth: deck gains 0–1, crossfader 0–1 (A to B).
   * Uses exponential smoothing on AudioParams to avoid zipper noise.
   */
  setMixerLevels(deckAGain: number, deckBGain: number, cross01: number): void {
    if (!this.ctx || !this.gainA || !this.gainB) return;
    const { panA, panB } = equalPowerCrossfade(cross01);
    const a = Math.max(0, Math.min(1, deckAGain)) * panA;
    const b = Math.max(0, Math.min(1, deckBGain)) * panB;
    const now = this.ctx.currentTime;
    this.gainA.gain.setTargetAtTime(a, now, SMOOTH_TC);
    this.gainB.gain.setTargetAtTime(b, now, SMOOTH_TC);
  }

  setLevels(deckAGain: number, deckBGain: number, cross01: number): void {
    this.setMixerLevels(deckAGain, deckBGain, cross01);
  }

  /**
   * Scratch / nudge: forward ~0.2–3×, reverse about −2…−0.25× when supported; otherwise reverse maps to slow forward.
   */
  setDeckPlaybackRate(deck: "a" | "b", rate: number): void {
    if (!this.ctx) return;
    const r = this.normalizeRate(rate);
    const now = this.ctx.currentTime;
    this.deckTransport(deck).targetRate = r;
    const s = this.deckSource(deck);
    if (s) {
      s.playbackRate.setTargetAtTime(r, now, 0.028);
    }
  }

  /** Signed scrub velocity from mapper (0 = no scrub). */
  setDeckScrubInput(deck: Deck, velocity: number): void {
    const tr = this.deckTransport(deck);
    const v = Number.isFinite(velocity) ? velocity : 0;
    tr.scrubVelocity = Math.max(-1, Math.min(1, v));
  }

  getDeckPlayhead(deck: Deck): number {
    return this.deckTransport(deck).playheadSec;
  }

  getDeckDuration(deck: Deck): number {
    return this.deckBuffer(deck)?.duration ?? 0;
  }

  /**
   * Advances transport and refreshes sources. Call from rAF while context is running.
   */
  tickTransport(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tickDeck = (deck: Deck) => {
      if (!this.isDeckPlayingFlag(deck)) return;
      const buf = this.deckBuffer(deck);
      if (!buf || buf.duration <= 0) return;
      const tr = this.deckTransport(deck);
      if (tr.lastTickCtxSec <= 0) tr.lastTickCtxSec = now;
      const dt = Math.max(0, now - tr.lastTickCtxSec);
      tr.lastTickCtxSec = now;
      const alpha = 1 - Math.exp(-dt / SCRUB_INPUT_SMOOTH_TAU);
      tr.scrubVelocitySmooth += (tr.scrubVelocity - tr.scrubVelocitySmooth) * alpha;

      if (Math.abs(tr.scrubVelocitySmooth) > SCRUB_DEAD_ZONE) {
        if (!tr.scrubSessionActive) {
          this.refreshPlayhead(deck, now);
          tr.scrubSessionActive = true;
          tr.scrubAnchorSec = tr.playheadSec;
          tr.scrubCommittedSec = tr.playheadSec;
        }
        tr.mode = "scrub";
      } else if (tr.mode === "scrub") {
        tr.mode = "normal";
        tr.targetRate = 1;
        tr.scrubRestartAccumSec = 0;
        const commit = tr.scrubSessionActive ? tr.scrubCommittedSec : tr.playheadSec;
        tr.playheadSec = commit;
        tr.scrubSessionActive = false;
        tr.scrubAnchorSec = commit;
        tr.scrubCommittedSec = commit;
        this.restartDeckSource(deck, { offsetSec: commit, rate: 1 });
      }

      if (tr.mode === "normal") {
        this.refreshPlayhead(deck, now);
        return;
      }

      // Scrub mode: move playhead directly and re-trigger very short source segments.
      const deltaSec = tr.scrubVelocitySmooth * SCRUB_PLAYHEAD_SPEED * dt;
      const base = tr.scrubSessionActive ? tr.scrubCommittedSec : tr.playheadSec;
      const committed = this.wrapOffset(base + deltaSec, buf.duration);
      tr.scrubCommittedSec = committed;
      tr.playheadSec = committed;
      tr.scrubRestartAccumSec += dt;
      const segRate = tr.scrubVelocitySmooth >= 0 ? 1 : this.reversePlaybackSupported ? -1 : 1;
      const current = this.deckSource(deck);
      const directionChanged = current != null && Math.sign(tr.sourceRate) !== Math.sign(segRate);
      if (current == null || tr.scrubRestartAccumSec >= SCRUB_RESTART_MIN_SEC || directionChanged) {
        this.restartDeckSource(deck, {
          offsetSec: tr.playheadSec,
          rate: segRate,
          segmentSec: SCRUB_SEGMENT_SEC,
        });
        tr.scrubRestartAccumSec = 0;
      }
    };
    tickDeck("a");
    tickDeck("b");
  }

  dispose(): void {
    this.stopAll();
    if (this.analyserA) {
      try {
        this.analyserA.disconnect();
      } catch {
        /* */
      }
    }
    if (this.analyserB) {
      try {
        this.analyserB.disconnect();
      } catch {
        /* */
      }
    }
    this.analyserA = null;
    this.analyserB = null;
    if (this.compressor) {
      try {
        this.compressor.disconnect();
      } catch {
        /* */
      }
    }
    this.compressor = null;
    if (this.gainA) {
      try {
        this.gainA.disconnect();
      } catch {
        /* */
      }
    }
    if (this.gainB) {
      try {
        this.gainB.disconnect();
      } catch {
        /* */
      }
    }
    this.gainA = null;
    this.gainB = null;
    if (this.ctx) {
      void this.ctx.close();
    }
    this.ctx = null;
    this.bufferA = null;
    this.bufferB = null;
  }
}
