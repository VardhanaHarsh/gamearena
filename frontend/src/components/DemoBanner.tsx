/** Always visible, cannot be dismissed. */
export function DemoBanner() {
  return (
    <div role="note" className="demo-banner sticky top-0 z-[60] text-black">
      <div className="bg-amber-300/85 px-3 py-1.5 text-center text-[11px] font-bold tracking-wide sm:text-xs">
        <span className="sm:hidden">⚠ DEMO MODE — VIRTUAL CREDITS ONLY · NO REAL MONEY</span>
        <span className="hidden sm:inline">⚠ DEMO MODE — ALL CREDITS ARE VIRTUAL AND HAVE NO REAL VALUE. NO REAL MONEY, PAYMENTS OR WITHDRAWALS.</span>
      </div>
    </div>
  )
}
