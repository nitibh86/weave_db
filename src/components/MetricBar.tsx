'use client'

interface MetricBarProps {
  letter: string
  label: string
  tooltip?: string
  score: number
  detail: string
}

export function MetricBar({ letter, label, tooltip, score, detail }: MetricBarProps) {
  const pct = Math.max(0, Math.min(100, score))

  return (
    <div className="grid items-center gap-4 py-3.5 border-b border-border last:border-0"
         style={{ gridTemplateColumns: '14px 110px 1fr 52px' }}>

      {/* Letter */}
      <span className="font-mono text-[10px] font-500 text-[#A8A8A8] uppercase tracking-widest">
        {letter}
      </span>

      {/* Label — with hover tooltip */}
      <div className="relative group/tip">
        <span className="font-sans text-[11px] font-500 text-[#6B6B6B] uppercase tracking-[0.07em] cursor-default border-b border-dashed border-transparent group-hover/tip:text-[#F54E00] group-hover/tip:border-[#F54E00] transition-colors">
          {label}
        </span>
        {tooltip && (
          <div className="absolute left-0 top-full mt-2 z-50 w-72 bg-white border border-[#E4E4E4] rounded px-3 py-2.5 shadow-sm pointer-events-none opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
            <p className="font-sans text-[12px] text-[#6B6B6B] leading-[1.65]">{tooltip}</p>
          </div>
        )}
      </div>

      {/* Bar track */}
      <div className="relative h-[3px] bg-[#EFEFEF] rounded-none overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-[#F54E00] transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Score + detail */}
      <div className="flex flex-col items-end gap-0.5">
        <span className="font-mono text-[15px] font-500 text-[#0C0C0C] tabular-nums">
          {score.toFixed(1)}
        </span>
      </div>

      {/* Detail string spans full width below */}
      <div /> {/* letter col spacer */}
      <div
        className="col-span-3 font-mono text-[11px] text-[#A8A8A8] tracking-tight -mt-2 pb-1"
      >
        {detail}
      </div>
    </div>
  )
}
