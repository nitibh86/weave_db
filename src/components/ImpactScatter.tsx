'use client'

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { EngineerScore } from '@/lib/types'

interface ImpactScatterProps {
  engineers: EngineerScore[]
  selectedLogin: string
  onSelect: (login: string) => void
}

// Custom dot — sized by substance, highlighted by selection
function CustomDot(props: {
  cx?: number
  cy?: number
  payload?: EngineerScore
  selectedLogin?: string
  onSelect?: (login: string) => void
}) {
  const { cx = 0, cy = 0, payload, selectedLogin, onSelect } = props
  if (!payload) return null

  const isSelected = payload.login === selectedLogin
  const r = 4 + (payload.substance / 100) * 7

  return (
    <circle
      cx={cx}
      cy={cy}
      r={isSelected ? r + 2 : r}
      fill={isSelected ? '#F54E00' : '#D4D4D4'}
      stroke={isSelected ? '#F54E00' : '#B0B0B0'}
      strokeWidth={isSelected ? 0 : 1}
      opacity={isSelected ? 1 : 0.75}
      style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
      onClick={() => onSelect?.(payload.login)}
    />
  )
}

// Custom tooltip
function ScatterTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: EngineerScore }>
}) {
  if (!active || !payload?.[0]) return null
  const eng = payload[0].payload

  return (
    <div className="bg-white border border-[#E4E4E4] rounded px-3 py-2 shadow-sm">
      <div className="font-mono text-[12px] font-500 text-[#0C0C0C] mb-1">
        {eng.login}
      </div>
      <div className="font-mono text-[11px] text-[#6B6B6B] space-y-0.5">
        <div>Breadth&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{eng.breadth.toFixed(1)}</div>
        <div>Acceleration {eng.acceleration.toFixed(1)}</div>
        <div>Substance&nbsp;&nbsp;&nbsp;{eng.substance.toFixed(1)}</div>
      </div>
    </div>
  )
}

// Quadrant corner labels rendered as custom SVG
function QuadrantLabels({ width, height }: { width: number; height: number }) {
  // chart margins from the ResponsiveContainer offset
  const pad = 4
  const style: React.CSSProperties = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    fill: '#C8C8C8',
    pointerEvents: 'none',
  }

  return (
    <g>
      <text x={width / 2 + pad} y={pad + 10} textAnchor="start" style={style}>
        High Breadth · Fast
      </text>
      <text x={pad} y={pad + 10} textAnchor="start" style={style}>
        Focused · Fast
      </text>
      <text x={width / 2 + pad} y={height - pad} textAnchor="start" style={style}>
        High Breadth · Slow
      </text>
      <text x={pad} y={height - pad} textAnchor="start" style={style}>
        Focused · Slow
      </text>
    </g>
  )
}

export function ImpactScatter({
  engineers,
  selectedLogin,
  onSelect,
}: ImpactScatterProps) {
  if (engineers.length === 0) return null

  return (
    <div className="w-full">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#A8A8A8]">
          Breadth vs Acceleration
        </span>
        <span className="font-mono text-[10px] text-[#C8C8C8]">
          dot size = substance
        </span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 16 }}>
          <CartesianGrid
            strokeDasharray="4 4"
            stroke="#EFEFEF"
            strokeWidth={1}
          />

          {/* Quadrant dividers */}
          <ReferenceLine
            x={50}
            stroke="#E4E4E4"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <ReferenceLine
            y={50}
            stroke="#E4E4E4"
            strokeWidth={1}
            strokeDasharray="2 2"
          />

          <XAxis
            type="number"
            dataKey="breadth"
            domain={[0, 100]}
            tick={{ fontFamily: "'DM Mono', monospace", fontSize: 9, fill: '#A8A8A8' }}
            tickLine={false}
            axisLine={{ stroke: '#E4E4E4' }}
            label={{
              value: 'Breadth →',
              position: 'insideBottomRight',
              offset: -4,
              style: {
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                fill: '#A8A8A8',
              },
            }}
          />

          <YAxis
            type="number"
            dataKey="acceleration"
            domain={[0, 100]}
            tick={{ fontFamily: "'DM Mono', monospace", fontSize: 9, fill: '#A8A8A8' }}
            tickLine={false}
            axisLine={{ stroke: '#E4E4E4' }}
            label={{
              value: 'Acceleration →',
              angle: -90,
              position: 'insideTopLeft',
              offset: 12,
              style: {
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                fill: '#A8A8A8',
              },
            }}
          />

          <Tooltip content={<ScatterTooltip />} />

          <Scatter
            data={engineers}
            shape={(props: object) => (
              <CustomDot
                {...(props as {
                  cx?: number
                  cy?: number
                  payload?: EngineerScore
                })}
                selectedLogin={selectedLogin}
                onSelect={onSelect}
              />
            )}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
