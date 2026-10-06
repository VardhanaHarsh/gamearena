import { useUi } from '../store/ui'

/**
 * Tiny synthesized sound effects (Web Audio API) — no audio files, no copyrighted assets.
 * Every effect respects the global Sound ON/OFF preference.
 */
export type SoundName = 'click' | 'dice' | 'move' | 'capture' | 'start' | 'win' | 'lose' | 'notify' | 'error' | 'turn'

let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())

function tone(freq: number, duration: number, { type = 'sine' as OscillatorType, gain = 0.08, delay = 0, slideTo }: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}) {
  const ac = audio()
  const t0 = ac.currentTime + delay
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration)
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

function noise(duration: number, gain = 0.05, delay = 0) {
  const ac = audio()
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * duration), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = ac.createBufferSource()
  const g = ac.createGain()
  g.gain.value = gain
  src.buffer = buffer
  src.connect(g).connect(ac.destination)
  src.start(ac.currentTime + delay)
}

const effects: Record<SoundName, () => void> = {
  click: () => tone(660, 0.05, { type: 'triangle', gain: 0.04 }),
  dice: () => [0, 0.06, 0.12, 0.2].forEach((d) => noise(0.05, 0.06, d)),
  move: () => tone(520, 0.08, { type: 'triangle', slideTo: 780 }),
  capture: () => tone(300, 0.25, { type: 'sawtooth', gain: 0.06, slideTo: 90 }),
  start: () => [440, 554, 659].forEach((f, i) => tone(f, 0.14, { type: 'triangle', delay: i * 0.1 })),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', delay: i * 0.12, gain: 0.07 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, { type: 'sine', delay: i * 0.15 })),
  notify: () => [880, 1320].forEach((f, i) => tone(f, 0.09, { delay: i * 0.08, gain: 0.05 })),
  error: () => tone(180, 0.18, { type: 'square', gain: 0.04 }),
  turn: () => tone(990, 0.1, { gain: 0.05 }),
}

export function play(name: SoundName) {
  if (!useUi.getState().sound) return
  try {
    effects[name]()
  } catch {
    /* audio unavailable (e.g. before first user gesture) */
  }
}
