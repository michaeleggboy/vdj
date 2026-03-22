import { equalPowerCrossfade } from "./crossfade";

const SMOOTH_TC = 0.035;

/**
 * Two-deck Web Audio graph: buffer sources (loop) → per-deck gain → light compressor → destination.
 * Levels follow mapper.smooth: effective gain = deckGain × equal-power crossfader pan.
 */
export class DjMixerEngine {
  private ctx: AudioContext | null = null;
  private gainA: GainNode | null = null;
  private gainB: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sourceA: AudioBufferSourceNode | null = null;
  private sourceB: AudioBufferSourceNode | null = null;
  private bufferA: AudioBuffer | null = null;
  private bufferB: AudioBuffer | null = null;
  private playing = false;

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private wireGraph(): void {
    if (!this.ctx || this.gainA) return;
    const c = this.ctx;
    this.gainA = c.createGain();
    this.gainB = c.createGain();
    this.gainA.gain.value = 0;
    this.gainB.gain.value = 0;
    this.compressor = c.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.1;
    this.gainA.connect(this.compressor);
    this.gainB.connect(this.compressor);
    this.compressor.connect(c.destination);
  }

  /** Create / resume AudioContext (call from a user gesture). */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
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

  private stopSources(): void {
    this.disconnectSource(this.sourceA);
    this.disconnectSource(this.sourceB);
    this.sourceA = null;
    this.sourceB = null;
  }

  private startSources(): void {
    if (!this.ctx || !this.gainA || !this.gainB) return;
    this.stopSources();
    const c = this.ctx;
    if (this.bufferA) {
      const s = c.createBufferSource();
      s.buffer = this.bufferA;
      s.loop = true;
      s.connect(this.gainA);
      s.start(0);
      this.sourceA = s;
    }
    if (this.bufferB) {
      const s = c.createBufferSource();
      s.buffer = this.bufferB;
      s.loop = true;
      s.connect(this.gainB);
      s.start(0);
      this.sourceB = s;
    }
    this.playing = this.bufferA !== null || this.bufferB !== null;
  }

  /** Decode and store buffer; if playing, restarts sources. */
  async loadDeck(deck: "a" | "b", file: File): Promise<void> {
    const ctx = await this.ensureContext();
    const ab = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    if (deck === "a") {
      this.bufferA = buffer;
    } else {
      this.bufferB = buffer;
    }
    if (this.playing) {
      this.startSources();
    }
  }

  play(): void {
    if (!this.ctx || !this.gainA || !this.gainB) return;
    this.startSources();
  }

  stop(): void {
    this.stopSources();
    this.playing = false;
  }

  /**
   * Drive from mapper.smooth: deck gains 0–1, crossfader 0–1 (A to B).
   * Uses exponential smoothing on AudioParams to avoid zipper noise.
   */
  setLevels(deckAGain: number, deckBGain: number, cross01: number): void {
    if (!this.ctx || !this.gainA || !this.gainB) return;
    const { panA, panB } = equalPowerCrossfade(cross01);
    const a = Math.max(0, Math.min(1, deckAGain)) * panA;
    const b = Math.max(0, Math.min(1, deckBGain)) * panB;
    const now = this.ctx.currentTime;
    this.gainA.gain.setTargetAtTime(a, now, SMOOTH_TC);
    this.gainB.gain.setTargetAtTime(b, now, SMOOTH_TC);
  }

  dispose(): void {
    this.stop();
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
