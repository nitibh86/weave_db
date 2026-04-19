'use client'

import { useState } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, ResponsiveContainer,
} from 'recharts'
import type { EngineerScore } from '@/lib/types'

type Metric = 'breadth' | 'acceleration' | 'substance'

const METRICS: { key: Metric; label: string }[] = [
  { key: 'breadth',      label: 'Breadth'      },
  { key: 'acceleration', label: 'Acceleration' },
  { key: 'substance',    label: 'Substance'    },
]

// ── Left: enlarged radar for the selected engineer ─────────────────

function EngineerRadar({ engineer }: { engineer: EngineerScore }) {
  const data = [
    { metric: 'Breadth',      value: engineer.breadth      },
    { metric: 'Acceleration', value: engineer.acceleration },
    { metric: 'Substance',    value: engineer.substance    },
  ]

  return (
    <div className="flex flex-col items-center justify-center h-full py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A8A8A8] mb-3 self-start">
        profile
      </span>

      <RadarChart
        width={288}
        height={216}
        data={data}
        cx="48%"
        cy="56%"
        outerRadius={58}
      >
        <PolarGrid
          stroke="#FBBFA0"
          strokeWidth={1}
          gridType="polygon"
        />
        <PolarAngleAxis
          dataKey="metric"
          tick={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            fill: '#F54E00',
            fontWeight: 500,
          }}
          tickLine={false}
        />
        <Radar
          dataKey="value"
          fill="#F54E00"
          fillOpacity={0.18}
          stroke="#F54E00"
          strokeWidth={1.5}
        />
      </RadarChart>

      <div className="text-center mt-1">
        <div className="font-mono text-[13px] font-500 text-[#0C0C0C]">
          {engineer.login}
        </div>
        <div className="font-mono text-[11px] text-[#F54E00] tabular-nums">
          {engineer.composite.toFixed(1)}
        </div>
      </div>
    </div>
  )
}

// ── Right: bar chart for a single metric across top 15 ────────────

function MetricChart({
  engineers,
  metric,
  selectedLogin,
}: {
  engineers: EngineerScore[]
  metric: Metric
  selectedLogin: string
}) {
  // Top 5 by composite score, then sorted by the selected metric for visual clarity
  const top5 = [...engineers]
    .slice(0, 5)
    .sort((a, b) => b[metric] - a[metric])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={top5}
        margin={{ top: 8, right: 12, bottom: 52, left: -8 }}
        barCategoryGap="22%"
      >
        <CartesianGrid strokeDasharray="4 4" stroke="#EFEFEF" vertical={false} />

        <XAxis
          dataKey="login"
          tick={{ fontFamily: "'DM Mono', monospace", fontSize: 9, fill: '#A8A8A8' }}
          tickLine={false}
          axisLine={{ stroke: '#E4E4E4' }}
          angle={-38}
          textAnchor="end"
          interval={0}
        />

        <YAxis
          domain={[0, 100]}
          tick={{ fontFamily: "'DM Mono', monospace", fontSize: 9, fill: '#C8C8C8' }}
          tickLine={false}
          axisLine={false}
          tickCount={5}
        />

        <Tooltip
          cursor={{ fill: '#F4F4F4' }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null
            const eng = payload[0].payload as EngineerScore
            const metaLabel = METRICS.find(m => m.key === metric)?.label ?? metric
            return (
              <div className="bg-white border border-[#E4E4E4] rounded px-3 py-2 shadow-sm">
                <div className="font-mono text-[11px] font-500 text-[#0C0C0C]">{eng.login}</div>
                <div className="font-mono text-[11px] text-[#6B6B6B]">
                  {metaLabel}&nbsp;&nbsp;{eng[metric].toFixed(1)}
                </div>
              </div>
            )
          }}
        />

        <Bar
          dataKey={metric}
          radius={[2, 2, 0, 0]}
        >
          {top5.map(eng => (
            <Cell
              key={eng.login}
              fill={eng.login === selectedLogin ? '#F54E00' : '#E4E4E4'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Composed bottom panel ──────────────────────────────────────────

export function BottomPanel({
  engineer,
  allEngineers,
  onSelectLogin,
}: {
  engineer: EngineerScore
  allEngineers: EngineerScore[]
  onSelectLogin: (login: string) => void
}) {
  const [activeMetric, setActiveMetric] = useState<Metric>('breadth')

  return (
    <div className="flex flex-1 overflow-hidden border-t border-[#E4E4E4]">

      {/* ── Left: radar ───────────────────────────────────────────── */}
      <div
        className="flex flex-col px-9 border-r border-[#E4E4E4] flex-shrink-0"
        style={{ width: 344 }}
      >
        <EngineerRadar engineer={engineer} />
      </div>

      {/* ── Right: metric bar chart ───────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 px-6 pt-4 pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A8A8A8] mb-2 flex-shrink-0">
          {METRICS.find(m => m.key === activeMetric)?.label} · top 5
        </span>

        {/* Chart fills remaining vertical space */}
        <div className="flex-1 min-h-0">
          <MetricChart
            engineers={allEngineers}
            metric={activeMetric}
            selectedLogin={engineer.login}
          />
        </div>

        {/* Metric switcher */}
        <div className="flex gap-2 pt-3 flex-shrink-0 border-t border-[#F0F0F0]">
          {METRICS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveMetric(key)}
              className={[
                'font-mono text-[11px] px-3 py-1 rounded border transition-colors',
                key === activeMetric
                  ? 'border-[#F54E00] text-[#F54E00] bg-[#FEF0EB]'
                  : 'border-[#E4E4E4] text-[#6B6B6B] hover:border-[#F54E00] hover:text-[#F54E00]',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
