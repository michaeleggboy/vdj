/**
 * Rough tempo estimate from decoded PCM (envelope + autocorrelation).
 * Display-only; wrong on sparse intros, live drums, or odd time signatures.
 */
export function estimateBpmFromBuffer(buffer: AudioBuffer): number | null {
  const sampleRate = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const length = buffer.length;
  const maxLen = Math.min(length, Math.floor(90 * sampleRate));
  if (maxLen < sampleRate) return null;

  const mono = new Float32Array(maxLen);
  for (let c = 0; c < nCh; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < maxLen; i++) mono[i] += ch[i];
  }
  const inv = 1 / nCh;
  for (let i = 0; i < maxLen; i++) mono[i] *= inv;

  const hop = 512;
  const frames = Math.floor(maxLen / hop);
  if (frames < 64) return null;

  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    const end = Math.min(start + hop, maxLen);
    for (let i = start; i < end; i++) {
      const v = mono[i];
      sum += v * v;
    }
    env[f] = Math.sqrt(sum / (end - start));
  }

  const diff = new Float32Array(frames - 1);
  for (let i = 0; i < diff.length; i++) {
    const d = env[i + 1] - env[i];
    diff[i] = d > 0 ? d : 0;
  }

  let mean = 0;
  for (let i = 0; i < diff.length; i++) mean += diff[i];
  mean /= diff.length;
  let varSum = 0;
  for (let i = 0; i < diff.length; i++) {
    const v = diff[i] - mean;
    varSum += v * v;
  }
  const std = Math.sqrt(varSum / Math.max(1, diff.length - 1)) || 1;
  for (let i = 0; i < diff.length; i++) diff[i] = (diff[i] - mean) / std;

  const fps = sampleRate / hop;
  const minBpm = 70;
  const maxBpm = 190;
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * fps));
  const maxLag = Math.min(Math.floor(diff.length / 2) - 1, Math.ceil((60 / minBpm) * fps));
  if (minLag >= maxLag) return null;

  const acAt = (lag: number) => {
    let s = 0;
    for (let i = 0; i < diff.length - lag; i++) s += diff[i] * diff[i + lag];
    return s / (diff.length - lag);
  };

  let bestLag = minLag;
  let best = acAt(minLag);
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const c = acAt(lag);
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }

  const foldIntoRange = (bpm: number): number => {
    let x = bpm;
    while (x < minBpm && x > 0) x *= 2;
    while (x > maxBpm) x /= 2;
    return x;
  };

  let bpm = (60 * fps) / bestLag;
  bpm = foldIntoRange(bpm);
  if (bpm < minBpm || bpm > maxBpm) return null;

  const halfLag = Math.round(bestLag / 2);
  if (halfLag >= minLag && halfLag <= maxLag) {
    const alt = foldIntoRange((60 * fps) / halfLag);
    if (alt >= minBpm && alt <= maxBpm && acAt(halfLag) > best * 0.45) {
      bpm = alt;
    }
  }

  return Math.round(bpm);
}
