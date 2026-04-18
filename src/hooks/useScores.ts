import useSWR from 'swr'
import type { EngineerScore } from '@/lib/types'

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export function useScores(topN = 5) {
  const { data, error, isLoading, mutate } = useSWR<EngineerScore[]>(
    `/api/scores?top=${topN}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )

  return {
    scores:    data ?? [],
    error:     error as Error | undefined,
    isLoading,
    refresh:   mutate,
  }
}

// Separate hook for the full dataset used by the scatter plot
export function useAllScores() {
  return useScores(50)
}
