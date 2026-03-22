/** Equal-power crossfade: cross 0 = full A, cross 1 = full B (DJ-style pan law). */
export function equalPowerCrossfade(cross01: number): { panA: number; panB: number } {
  const t = Math.max(0, Math.min(1, cross01)) * (Math.PI * 0.5);
  return { panA: Math.cos(t), panB: Math.sin(t) };
}
