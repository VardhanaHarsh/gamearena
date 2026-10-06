import { useEffect, useRef } from 'react'

const GLYPHS = ['🎲', '♟', '⭕', '🟡', '🔴', '🎯', '✦', '◆']

/** Lightweight canvas particle field with drifting game glyphs. Pauses when hidden; static under reduced motion. */
export function Particles({ density = 34 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let raf = 0
    const dpr = Math.min(devicePixelRatio, 2)
    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const parts = Array.from({ length: density }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 0.15 + Math.random() * 0.35,
      vx: (Math.random() - 0.5) * 0.2,
      r: 10 + Math.random() * 16,
      a: 0.08 + Math.random() * 0.22,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.01,
      g: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    }))
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of parts) {
        if (!reduce) {
          p.y -= p.vy
          p.x += p.vx
          p.rot += p.vr
          if (p.y < -30) {
            p.y = h + 30
            p.x = Math.random() * w
          }
        }
        ctx.save()
        ctx.globalAlpha = p.a
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.font = `${p.r}px serif`
        ctx.fillText(p.g, -p.r / 2, p.r / 2)
        ctx.restore()
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    draw()
    const onVis = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden && !reduce) raf = requestAnimationFrame(draw)
    }
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [density])
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
}
