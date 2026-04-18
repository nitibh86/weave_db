'use client'

import type { EngineerScore } from '@/lib/types'
import { MetricBar } from './MetricBar'
import { BottomPanel } from './BottomPanel'

interface DetailPanelProps {
  engineer: EngineerScore | null
  allEngineers: EngineerScore[]
  onSelectLogin: (login: string) => void
}

export function DetailPanel({ engineer, allEngineers, onSelectLogin }: DetailPanelProps) {
  if (!engineer) return null

  const breadthDetail = [
    engineer.nDirs    ? `${engineer.nDirs} dirs`          : null,
    engineer.nCollabs ? `${engineer.nCollabs} collaborators` : null,
  ].filter(Boolean).join(' · ')

  const accelDetail = engineer.medianUnblockH != null
    ? `${engineer.medianUnblockH}h median · ${engineer.nUnblocks} qualifying reviews`
    : 'no qualifying reviews in window'

  const substanceDetail = [
    `${engineer.nPrs} PRs authored`,
  ].filter(Boolean).join(' · ')

  const pct = (w: number) => `${Math.round(w * 100)}%`

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ── Hero row ─────────────────────────────────────────────── */}
      <div className="flex items-end justify-between px-8 pt-6 pb-5 border-b border-[#E4E4E4]">
        <div>
          <h2 className="font-sans text-[21px] font-600 text-[#0C0C0C] tracking-tight leading-none">
            {engineer.login}
          </h2>
          <p className="font-mono text-[11px] text-[#A8A8A8] mt-1.5 tracking-wide">
            rank #{engineer.rank}&nbsp;&nbsp;·&nbsp;&nbsp;90-day window&nbsp;&nbsp;·&nbsp;&nbsp;{engineer.nPrs} PRs
          </p>
        </div>

        <div className="text-right">
          <div className="font-mono text-[54px] font-500 text-[#F54E00] leading-none tabular-nums tracking-tight">
            {engineer.composite.toFixed(1)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#C8C8C8] mt-1">
            composite
          </div>
        </div>
      </div>

      {/* ── Metrics ──────────────────────────────────────────────── */}
      <div className="px-8 py-1">
        <MetricBar
          letter="B" label="Breadth" score={engineer.breadth} detail={breadthDetail}
          tooltip={`Unique top-level directories touched across all authored PRs, plus unique collaborators (reviewers of their PRs and PRs they reviewed). Wider cross-team and cross-codebase work scores higher. Weighted ${pct(engineer.weights.breadth)} of composite (variance-derived).`}
        />
        <MetricBar
          letter="A" label="Acceleration" score={engineer.acceleration} detail={accelDetail}
          tooltip={`Median hours from the last APPROVED review to merge, counting only reviews where merge happened within 48h. Reviews where the delay was author-side are excluded. Lower hours → higher score (inverted). Weighted ${pct(engineer.weights.acceleration)} of composite (variance-derived).`}
        />
        <MetricBar
          letter="S" label="Substance" score={engineer.substance} detail={substanceDetail}
          tooltip={`Mean intent score across authored PRs. Conventional-commit prefixes (feat/fix → 1.0, chore/ci → 0.0) used when GitHub labels are absent or neutral. Each linked issue adds +0.1, capped at 1.0. Weighted ${pct(engineer.weights.substance)} of composite (variance-derived).`}
        />
      </div>

      {/* ── Bottom: radar + metric chart ─────────────────────────── */}
      <BottomPanel
        engineer={engineer}
        allEngineers={allEngineers}
        onSelectLogin={onSelectLogin}
      />
    </div>
  )
}
