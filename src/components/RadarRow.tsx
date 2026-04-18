'use client'

import { RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts'
import type { EngineerScore } from '@/lib/types'

function MiniRadar({
  engineer,
  isSelected,
  onSelect,
}: {
  engineer: EngineerScore
  isSelected: boolean
  onSelect: (login: string) => void
}) {
  const data = [
    { metric: 'B', value: engineer.breadth },
    { metric: 'A', value: engineer.acceleration },
    { metric: 'S', value: engineer.substance },
  ]

  return (
    <div
      className="flex flex-col items-center cursor-pointer group select-none"
      onClick={() => onSelect(engineer.login)}
    >
      <div
        className="rounded transition-colors duration-100"
        style={{
          background: isSelected ? '#FEF0EB' : 'transparent',
          padding: '4px 6px 0',
        }}
      >
        <RadarChart
          width={118}
          height={108}
          data={data}
          cx="50%"
          cy="52%"
          outerRadius={38}
        >
          <PolarGrid
            stroke={isSelected ? '#FBBFA0' : '#E0E0E0'}
            strokeWidth={1}
            gridType="polygon"
          />
          <PolarAngleAxis
            dataKey="metric"
            tick={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              fill: isSelected ? '#F54E00' : '#A8A8A8',
              fontWeight: isSelected ? 600 : 400,
            }}
            tickLine={false}
          />
          <Radar
            dataKey="value"
            fill={isSelected ? '#F54E00' : '#C8C8C8'}
            fillOpacity={isSelected ? 0.2 : 0.25}
            stroke={isSelected ? '#F54E00' : '#A8A8A8'}
            strokeWidth={isSelected ? 1.5 : 1}
          />
        </RadarChart>
      </div>

      {/* Name + composite */}
      <div className="mt-1.5 text-center w-[118px]">
        <div
          className={[
            'font-mono text-[11px] font-500 truncate px-1',
            isSelected
              ? 'text-[#F54E00]'
              : 'text-[#3A3A3A] group-hover:text-[#0C0C0C]',
          ].join(' ')}
        >
          {engineer.login}
        </div>
        <div
          className={[
            'font-mono text-[12px] tabular-nums',
            isSelected ? 'text-[#F54E00]' : 'text-[#C8C8C8]',
          ].join(' ')}
        >
          {engineer.composite.toFixed(1)}
        </div>
      </div>
    </div>
  )
}

export function RadarRow({
  engineers,
  selectedLogin,
  onSelect,
}: {
  engineers: EngineerScore[]
  selectedLogin: string
  onSelect: (login: string) => void
}) {
  const top5 = engineers.slice(0, 5)
  if (top5.length === 0) return null

  return (
    <div className="px-8 pt-4 pb-2 border-t border-[#E4E4E4]">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A8A8A8]">
          B · A · S profiles
        </span>
        <span className="font-mono text-[10px] text-[#C8C8C8]">
          top {top5.length} engineers
        </span>
      </div>

      <div className="flex items-start justify-around gap-2">
        {top5.map(eng => (
          <MiniRadar
            key={eng.login}
            engineer={eng}
            isSelected={eng.login === selectedLogin}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
