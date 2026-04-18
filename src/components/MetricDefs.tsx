'use client'

const DEFS = [
  {
    key: 'B',
    name: 'Breadth',
    formula: 'unique dirs + unique collaborators → normalised 0–100',
    body:
      'Measures how widely an engineer works across the codebase and team. Combines top-level directories touched in authored PRs with unique collaborators — reviewers of their PRs plus PRs they reviewed.',
  },
  {
    key: 'A',
    name: 'Acceleration',
    formula: 'median hours: last APPROVED review → merge (≤48h window) · inverted',
    body:
      'Measures how quickly an engineer\'s approval unblocks a PR. Only the final APPROVED review per PR counts; reviews where merge took more than 48h are excluded since that delay is author-side, not reviewer-side. Lower hours → higher score.',
  },
  {
    key: 'S',
    name: 'Substance',
    formula: 'mean intent score: bug/feature/enhancement = 1.0 · chore/ci = 0.0 · unlabelled = 0.5',
    body:
      'Measures whether work targets real product problems. Bug, enhancement, and feature PRs score high. Dependency bumps, CI changes, and chores score low. Each linked issue (Closes #N) adds a +0.1 bonus, capped at 1.0.',
  },
] as const

export function MetricDefs() {
  return (
    <div className="px-8 pt-5 pb-6 border-t border-[#E4E4E4] mt-auto flex-1 overflow-hidden">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A8A8A8]">
          Score definitions
        </span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {DEFS.map(d => (
          <div key={d.key}>
            {/* Header row */}
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="font-mono text-[11px] font-600 text-[#F54E00]">{d.key}</span>
              <span className="font-sans text-[11px] font-600 text-[#0C0C0C] uppercase tracking-[0.06em]">
                {d.name}
              </span>
            </div>

            {/* Formula pill */}
            <div className="font-mono text-[10px] text-[#A8A8A8] bg-[#F4F4F4] rounded px-2 py-1 mb-2 leading-snug">
              {d.formula}
            </div>

            {/* Description */}
            <p className="font-sans text-[12px] text-[#6B6B6B] leading-[1.65]">
              {d.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
