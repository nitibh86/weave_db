'use client'

import { useState, useCallback } from 'react'
import { useScores, useAllScores } from '@/hooks/useScores'
import { RankList } from '@/components/RankList'
import { DetailPanel } from '@/components/DetailPanel'

export default function DashboardPage() {
  const { scores: top5,    isLoading: loadingTop, error: topErr,  refresh: refreshTop  } = useScores(5)
  const { scores: allEngs, isLoading: loadingAll,                  refresh: refreshAll  } = useAllScores()

  const [selectedIndex, setSelectedIndex] = useState(0)

  // Keep selectedIndex in bounds if top5 shrinks
  const safeIndex = Math.min(selectedIndex, Math.max(0, top5.length - 1))
  const selected  = top5[safeIndex] ?? null

  // When scatter dot is clicked, find that login in top5
  const handleScatterSelect = useCallback((login: string) => {
    const idx = top5.findIndex(e => e.login === login)
    if (idx !== -1) setSelectedIndex(idx)
  }, [top5])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshTop(), refreshAll()])
  }, [refreshTop, refreshAll])

  // ── Total PR count for header ────────────────────────────────────
  const totalPrs = allEngs.reduce((s, e) => s + e.nPrs, 0)

  // ── Empty / loading / error states ──────────────────────────────
  const isEmpty = !loadingTop && !topErr && top5.length === 0

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-[#FAFAFA]">

      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 border-b border-[#E4E4E4] h-[44px] flex-shrink-0 bg-white">
        <div className="flex items-center gap-3">
          {/* PostHog hedgehog glyph — plain text stand-in */}
          <span className="text-[#F54E00] text-[14px]">🦔</span>
          <span className="font-mono text-[12px] font-500 text-[#0C0C0C] uppercase tracking-[0.12em]">
            PostHog Impact
          </span>
        </div>

        <div className="flex items-center gap-4">
          {!isEmpty && (
            <span className="font-mono text-[11px] text-[#A8A8A8] tabular-nums">
              90 days
              <span className="mx-2 text-[#E4E4E4]">·</span>
              {totalPrs > 0 ? `${totalPrs}+ PRs` : '—'}
              <span className="mx-2 text-[#E4E4E4]">·</span>
              {allEngs.length > 0 ? `${allEngs.length} engineers` : '—'}
            </span>
          )}

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={loadingTop || loadingAll}
            className={[
              'font-mono text-[11px] px-3 py-1 rounded border transition-colors',
              (loadingTop || loadingAll)
                ? 'border-[#E4E4E4] text-[#A8A8A8] cursor-not-allowed'
                : 'border-[#E4E4E4] text-[#6B6B6B] hover:border-[#F54E00] hover:text-[#F54E00]',
            ].join(' ')}
          >
            {(loadingTop || loadingAll) ? 'loading…' : 'refresh'}
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Loading */}
        {loadingTop && (
          <div className="flex items-center justify-center w-full">
            <span className="font-mono text-[12px] text-[#A8A8A8]">loading…</span>
          </div>
        )}

        {/* Error */}
        {topErr && !loadingTop && (
          <div className="flex items-center justify-center w-full">
            <span className="font-mono text-[12px] text-[#F54E00]">
              Error: {topErr.message}
            </span>
          </div>
        )}

        {/* Empty — collection running server-side on startup */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center w-full gap-3">
            <p className="font-sans text-[14px] text-[#6B6B6B]">Collecting data…</p>
            <p className="font-mono text-[12px] text-[#A8A8A8]">
              Fetching PRs from GitHub. This takes ~2 minutes.
            </p>
            <p className="font-mono text-[11px] text-[#C8C8C8]">
              Watch server logs for progress, then click refresh.
            </p>
          </div>
        )}

        {/* Dashboard */}
        {!loadingTop && !topErr && top5.length > 0 && (
          <>
            <RankList
              engineers={top5}
              selectedIndex={safeIndex}
              onSelect={setSelectedIndex}
            />
            <DetailPanel
              engineer={selected}
              allEngineers={allEngs.length > 0 ? allEngs : top5}
              onSelectLogin={handleScatterSelect}
            />
          </>
        )}
      </div>
    </div>
  )
}
