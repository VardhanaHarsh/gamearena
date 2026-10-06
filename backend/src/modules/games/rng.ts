import { randomInt } from 'node:crypto'
import type { Rng } from './engine.js'

/** Production RNG: crypto-secure. Dice values are generated here, never accepted from clients. */
export const secureRng: Rng = {
  int: (min, max) => randomInt(min, max),
  float: () => randomInt(0, 2 ** 31) / 2 ** 31,
}

/** Deterministic RNG (mulberry32) for tests and replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  const float = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { float, int: (min, max) => min + Math.floor(float() * (max - min)) }
}
