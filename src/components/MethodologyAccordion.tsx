'use client'

import { useState } from 'react'

const ITEMS = [
  {
    key: 'B',
    label: 'Breadth',
    body: `Measures how widely an engineer's work touches the codebase and how many teammates they collaborate with. Score combines unique top-level directories touched across authored PRs with unique collaborators (people whose PRs they reviewed, or who reviewed theirs), normalised against the team maximum. Engineers who contribute across product areas and review across teams create wider leverage than those working in isolation.`,
  },
  {
    key: 'A',
    label: 'Acceleration',
    body: `Measures how quickly an engineer's approval leads to a PR being merged — a proxy for unblocking others. Only the final APPROVED review before merge counts; earlier reviewers in the same PR are excluded. Reviews where the PR took more than 48 hours to merge after approval are also excluded, since that delay is typically on the author or process, not the reviewer. Score is the median qualifying unblock time, inverted — faster is better.`,
  },
  {
    key: 'S',
    label: 'Substance',
    body: `Measures whether an engineer is solving real product problems. PRs labelled as bugs, enhancements, or feature work score higher. Dependency bumps, CI changes, and chores score lower. Unlabelled PRs are neutral. Each linked issue (Closes #N in the PR body) adds a bonus. An engineer who ships features and also does maintenance will score well; one whose 90-day contribution is only dependency bumps will score lower — the correct signal for impact.`,
  },
]

export function MethodologyAccordion() {
  const [open, setOpen] = useState(false)
  const [openItem, setOpenItem] = useState<string | null>(null)

  return (
    <div className="border-t border-[#E4E4E4] mt-auto">
      {/* Outer toggle */}
      <button
        onClick={() => { setOpen(v => !v); if (open) setOpenItem(null) }}
        className="flex items-center justify-between w-full py-3 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#C8C8C8]">
          How scores are calculated
        </span>
        <span
          className="font-mono text-[10px] text-[#C8C8C8] transition-transform duration-200"
          style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="pb-4 space-y-0">
          {ITEMS.map(item => (
            <div key={item.key} className="border-t border-[#F0F0F0] first:border-0">
              <button
                onClick={() => setOpenItem(openItem === item.key ? null : item.key)}
                className="flex items-center gap-3 w-full py-2.5 text-left hover:bg-[#FAFAFA] transition-colors"
              >
                <span className="font-mono text-[10px] font-500 text-[#F54E00] w-3">
                  {item.key}
                </span>
                <span className="font-sans text-[12px] font-500 text-[#6B6B6B] uppercase tracking-[0.06em]">
                  {item.label}
                </span>
                <span
                  className="font-mono text-[9px] text-[#C8C8C8] ml-auto transition-transform duration-150"
                  style={{ display: 'inline-block', transform: openItem === item.key ? 'rotate(180deg)' : '' }}
                >
                  ▾
                </span>
              </button>

              {openItem === item.key && (
                <p className="font-sans text-[12px] leading-relaxed text-[#6B6B6B] pb-3 pl-6 pr-2">
                  {item.body}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
