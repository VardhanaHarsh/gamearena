import { useId } from 'react'

/**
 * Hand-drawn SVG logos for each game (no emoji, no external assets).
 * Every logo sits on a rounded "app icon" tile with depth (gradient + inner highlight + shadow).
 */
export function GameIcon({ game, size = 48, className = '' }: { game: string; size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const Art = ART[game] ?? ART.default
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`shrink-0 drop-shadow-[0_6px_14px_rgba(0,0,0,.35)] ${className}`} role="img" aria-label={`${game} logo`}>
      <Art id={id} />
      {/* glossy top highlight shared by every tile */}
      <path d="M8 4h48a6 6 0 0 1 6 6v14C44 30 20 30 2 24V10a6 6 0 0 1 6-6Z" fill="#fff" opacity=".12" />
    </svg>
  )
}

type ArtProps = { id: string }

const Tile = ({ id, from, to }: { id: string; from: string; to: string }) => (
  <>
    <defs>
      <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={from} />
        <stop offset="1" stopColor={to} />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${id}t)`} />
    <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1.5" />
  </>
)

const ART: Record<string, (p: ArtProps) => React.ReactElement> = {
  ludo: ({ id }) => (
    <g>
      <Tile id={id} from="#312e81" to="#0f172a" />
      {/* four yards */}
      <rect x="10" y="10" width="18" height="18" rx="4" fill="#ef4444" />
      <rect x="36" y="10" width="18" height="18" rx="4" fill="#22c55e" />
      <rect x="10" y="36" width="18" height="18" rx="4" fill="#3b82f6" />
      <rect x="36" y="36" width="18" height="18" rx="4" fill="#eab308" />
      {/* centre home */}
      <path d="M28 28h8l-4 4Z" fill="#22c55e" />
      <path d="M36 28v8l-4-4Z" fill="#eab308" />
      <path d="M28 36h8l-4-4Z" fill="#3b82f6" />
      <path d="M28 28v8l4-4Z" fill="#ef4444" />
      {/* tilted die */}
      <g transform="rotate(-14 41 23)">
        <rect x="31" y="13" width="20" height="20" rx="5" fill="#fff" stroke="#cbd5e1" />
        <circle cx="36.5" cy="18.5" r="2" fill="#111827" />
        <circle cx="41" cy="23" r="2" fill="#111827" />
        <circle cx="45.5" cy="27.5" r="2" fill="#111827" />
      </g>
      {/* pawn */}
      <g>
        <ellipse cx="19" cy="47.5" rx="5" ry="1.6" fill="#000" opacity=".3" />
        <path d="M15.5 47c0-4 1.5-6 3.5-7-2-1-2.6-3.6-.8-5.2a3.4 3.4 0 0 1 4.6 0c1.8 1.6 1.2 4.2-.8 5.2 2 1 3.5 3 3.5 7Z" fill="#fff" />
      </g>
    </g>
  ),
  carrom: ({ id }) => (
    <g>
      <Tile id={id} from="#92400e" to="#451a03" />
      <rect x="9" y="9" width="46" height="46" rx="5" fill="#f3d9a4" />
      <rect x="9" y="9" width="46" height="46" rx="5" fill="none" stroke="#5b3410" strokeWidth="2" />
      {[[13, 13], [51, 13], [13, 51], [51, 51]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="3.6" fill="#1c1410" />
      ))}
      <circle cx="32" cy="32" r="9" fill="none" stroke="#7c4a1e" strokeWidth="1" />
      {[
        [32, 26, '#2b2523'], [37.2, 29, '#f5f0e6'], [37.2, 35, '#2b2523'], [32, 38, '#f5f0e6'], [26.8, 35, '#2b2523'], [26.8, 29, '#f5f0e6'],
      ].map(([x, y, c]) => (
        <circle key={`${x}${y}`} cx={x as number} cy={y as number} r="2.7" fill={c as string} stroke="#00000040" strokeWidth=".5" />
      ))}
      <circle cx="32" cy="32" r="2.7" fill="#dc2626" />
      {/* striker with aim line */}
      <line x1="32" y1="47" x2="32" y2="40" stroke="#7c3aed" strokeWidth="1.2" strokeDasharray="1.6 1.2" />
      <circle cx="32" cy="48" r="3.6" fill="#60a5fa" stroke="#1e3a8a" strokeWidth="1" />
    </g>
  ),
  tictactoe: ({ id }) => (
    <g>
      <Tile id={id} from="#6d28d9" to="#0e7490" />
      <g stroke="#fff" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round">
        <path d="M25 12v40M39 12v40M12 25h40M12 39h40" />
      </g>
      <g stroke="#f0abfc" strokeWidth="3.6" strokeLinecap="round">
        <path d="M14 14l7 7M21 14l-7 7" />
        <path d="M28 28l8 8M36 28l-8 8" />
      </g>
      <circle cx="46" cy="18" r="4.2" fill="none" stroke="#67e8f9" strokeWidth="3.4" />
      <circle cx="18" cy="46" r="4.2" fill="none" stroke="#67e8f9" strokeWidth="3.4" />
      <path d="M43 43l7 7M50 43l-7 7" stroke="#f0abfc" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M12 12L52 52" stroke="#fde047" strokeWidth="2" strokeLinecap="round" opacity=".9" />
    </g>
  ),
  connectfour: ({ id }) => (
    <g>
      <Tile id={id} from="#1d4ed8" to="#172554" />
      {Array.from({ length: 4 }, (_, r) =>
        Array.from({ length: 4 }, (_, c) => {
          const filled: Record<string, string> = { '3-0': '#ef4444', '3-1': '#facc15', '3-2': '#ef4444', '3-3': '#facc15', '2-1': '#ef4444', '2-2': '#facc15', '1-2': '#ef4444', '2-0': '#facc15', '0-3': '#ef4444' }
          const fill = filled[`${r}-${c}`] ?? '#0b1a4a'
          return <circle key={`${r}${c}`} cx={14 + c * 12} cy={15 + r * 11.5} r="4.6" fill={fill} stroke={fill === '#0b1a4a' ? '#0a1238' : '#00000033'} />
        }),
      )}
      {/* winning diagonal glow */}
      <path d="M14 49.5L50 15" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".55" strokeDasharray="2 2.5" />
    </g>
  ),
  chess: ({ id }) => (
    <g>
      <Tile id={id} from="#475569" to="#0f172a" />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={8 + (i % 4) * 12} y={8 + Math.floor(i / 4) * 12} width="12" height="12" fill={(i + Math.floor(i / 4)) % 2 ? '#ffffff14' : 'transparent'} />
      ))}
      <path d="M22 52h22v-4H22Zm3-6h16c0-6-3-9-3-14 2-1 4-3 4-6 0-6-6-11-12-11-3 0-4 2-4 2l1 3-6 6c-1 1-1 3 1 4 2 0 3-1 5-2 0 4-3 6-3 11 0 3 1 5 1 7Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="1" />
      <circle cx="31" cy="21" r="1.3" fill="#0f172a" />
    </g>
  ),
  checkers: ({ id }) => (
    <g>
      <Tile id={id} from="#991b1b" to="#1f2937" />
      <ellipse cx="32" cy="44" rx="17" ry="6" fill="#111827" />
      <rect x="15" y="36" width="34" height="8" fill="#111827" />
      <ellipse cx="32" cy="36" rx="17" ry="6" fill="#374151" />
      <ellipse cx="32" cy="34" rx="17" ry="6" fill="#dc2626" />
      <rect x="15" y="26" width="34" height="8" fill="#dc2626" />
      <ellipse cx="32" cy="26" rx="17" ry="6" fill="#ef4444" />
      <ellipse cx="32" cy="26" rx="11" ry="3.6" fill="none" stroke="#fecaca" strokeOpacity=".6" />
      <path d="M24 25l2-6 3 3 3-5 3 5 3-3 2 6Z" fill="#fde047" stroke="#a16207" strokeWidth=".6" />
    </g>
  ),
  default: ({ id }) => (
    <g>
      <Tile id={id} from="#8b5cf6" to="#22d3ee" />
      <path d="M20 26h24a8 8 0 0 1 8 8v4a6 6 0 0 1-11 3l-2-3H25l-2 3a6 6 0 0 1-11-3v-4a8 8 0 0 1 8-8Z" fill="#fff" />
    </g>
  ),
}
