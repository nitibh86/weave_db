import useSWR from 'swr'

type Summary = {
  totalPrs: number
  totalEngineers: number
  scoredEngineers: number
  minPrs: number
  lastMergedAt: string | null
}

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export function useSummary(minPrs = 3) {
  const { data, error, isLoading, mutate } = useSWR<Summary>(
    `/api/summary?minPrs=${minPrs}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )

  return {
    summary: data ?? null,
    error: error as Error | undefined,
    isLoading,
    refresh: mutate,
  }
}

