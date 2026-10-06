/** Dependency-free SVG charts for the admin dashboard. */
export function BarChart({ data, color = 'var(--primary-2)', label }: { data: { label: string; value: number }[]; color?: string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <figure aria-label={label}>
      <div className="flex h-40 items-end gap-1">
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="rounded-t-md transition-all duration-500 group-hover:brightness-125" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0, background: color }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap shadow group-hover:block">
              {d.label}: {d.value}
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between font-mono text-[10px] text-subtle">
        <span>{data[0]?.label.slice(5)}</span>
        <span>{data[data.length - 1]?.label.slice(5)}</span>
      </figcaption>
    </figure>
  )
}

export function HorizontalBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted capitalize">{d.label}</span>
            <span className="font-mono">{d.value}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className="h-2 rounded-full bg-gradient-to-r from-primary to-cyan transition-all duration-700" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
      {!data.length && <li className="text-sm text-subtle">No data yet.</li>}
    </ul>
  )
}
