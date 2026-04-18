'use client'

import type { EngineerScore } from '@/lib/types'

interface RankListProps {
  engineers: EngineerScore[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export function RankList({ engineers, selectedIndex, onSelect }: RankListProps) {
  return (
    <nav
      className="flex flex-col border-r border-[#E4E4E4] overflow-y-auto"
      style={{ width: 330, flexShrink: 0 }}
    >
      {/* Panel label */}
      <div className="px-6 py-4 border-b border-[#E4E4E4]">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#A8A8A8]">
          Top Engineers
        </span>
      </div>

      {engineers.map((eng, i) => {
        const isSelected = i === selectedIndex
        return (
          <button
            key={eng.login}
            onClick={() => onSelect(i)}
            className={[
              'flex items-center gap-4 px-6 py-4 text-left w-full transition-colors duration-100',
              'border-b border-[#E4E4E4] last:border-0',
              'border-l-[3px]',
              isSelected
                ? 'border-l-[#F54E00] bg-[#FEF0EB]'
                : 'border-l-transparent hover:bg-[#F4F4F4]',
            ].join(' ')}
          >
            {/* Rank */}
            <span className="font-mono text-[13px] text-[#C8C8C8] w-5 flex-shrink-0">
              {eng.rank}
            </span>

            {/* Login */}
            <span
              className={[
                'font-sans text-[15px] font-500 flex-1 truncate',
                isSelected ? 'text-[#0C0C0C]' : 'text-[#3A3A3A]',
              ].join(' ')}
            >
              {eng.login}
            </span>

            {/* Score */}
            <span
              className={[
                'font-mono text-[14px] font-500 flex-shrink-0 tabular-nums',
                isSelected ? 'text-[#F54E00]' : 'text-[#A8A8A8]',
              ].join(' ')}
            >
              {eng.composite.toFixed(1)}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
