export interface MetricWeights {
  breadth:      number   // 0–1, sums to 1 with the other two
  acceleration: number
  substance:    number
}

export interface EngineerScore {
  rank: number
  login: string
  composite: number      // 0–100 variance-weighted composite
  breadth: number        // 0–100 normalised
  acceleration: number   // 0–100 normalised (inverted — lower hours = higher score)
  substance: number      // 0–100 normalised

  // Raw inputs exposed for display
  nPrs: number
  nUnblocks: number      // qualifying unblock events (APPROVED, ≤48h to merge)
  nDirs: number          // unique top-level dirs touched
  nCollabs: number       // unique collaborators
  medianUnblockH: number | null   // median hours from approval → merge

  weights: MetricWeights  // variance-derived weights used for this cohort
  topPrs?: TopPR[]
}

export interface TopPR {
  number: number
  title: string
}

export interface CollectResult {
  status: 'done' | 'error'
  message?: string
  prCount?: number
  reviewCount?: number
  engineerCount?: number
}

// Raw DB row types (what better-sqlite3 returns)
export interface PrDirectoryRow {
  pr_number: number
  author_login: string
  merged_at: string
  directories: string    // JSON
  linked_issues: string  // JSON
  labels: string         // JSON
  title: string
}

export interface PrReviewRow {
  pr_number: number
  reviewer: string
  reviewed_at: string
  opened_at: string | null
  merged_at: string | null
  hours_open_to_review: number | null
  hours_review_to_merge: number | null
  review_state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'
}
