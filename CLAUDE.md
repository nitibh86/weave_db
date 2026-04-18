# PostHog Engineering Impact Dashboard
## Claude Code implementation spec — TypeScript fullstack

---

## What you are building

A single-page, fullstack TypeScript dashboard that answers one question:

> **"Who are the most impactful engineers at PostHog right now, and why?"**

Audience: a busy engineering leader. They understand code. They are not reading every PR.
The dashboard fits a single laptop screen. No scrolling on the outer container.

---

## Architecture

```
Next.js 14 (App Router)
├── API routes         — /api/scores, /api/collect
├── SQLite             — better-sqlite3 (sync, fast, zero config)
├── GitHub GraphQL     — fetch() with cursor pagination
├── React frontend     — ShadCN (customised) + Recharts
└── TypeScript end-to-end
```

**Why Next.js:** Single project, no CORS, API routes run in the same process as data access,
zero deployment friction (Vercel one-click or `next start`).

---

## Project structure

```
posthog-impact/
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── components.json          — shadcn config
├── .env.local               — GITHUB_TOKEN=ghp_xxx
│
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx         — root dashboard page
│   │   ├── globals.css      — design system + shadcn overrides
│   │   └── api/
│   │       ├── scores/
│   │       │   └── route.ts — GET /api/scores
│   │       └── collect/
│   │           └── route.ts — POST /api/collect (trigger pipeline)
│   │
│   ├── components/
│   │   ├── ui/              — shadcn primitives (customised)
│   │   │   ├── badge.tsx
│   │   │   ├── accordion.tsx
│   │   │   └── separator.tsx
│   │   ├── RankList.tsx
│   │   ├── DetailPanel.tsx
│   │   ├── MetricBar.tsx
│   │   ├── ImpactScatter.tsx
│   │   └── MethodologyAccordion.tsx
│   │
│   ├── lib/
│   │   ├── db.ts            — better-sqlite3 singleton
│   │   ├── collect.ts       — GitHub GraphQL → SQLite
│   │   ├── score.ts         — SQLite → EngineerScore[]
│   │   └── types.ts         — shared types
│   │
│   └── hooks/
│       └── useScores.ts     — SWR data fetching hook
│
└── reference/
    ├── collect.py           — Python reference (DO NOT MODIFY)
    └── score.py             — Python reference (DO NOT MODIFY)
```

---

## Step 1 — Shared types (`src/lib/types.ts`)

```typescript
export interface EngineerScore {
  rank: number
  login: string
  composite: number     // 0–100
  breadth: number       // 0–100
  acceleration: number  // 0–100
  substance: number     // 0–100
  nPrs: number
  nUnblocks: number
  nDirs: number
  nCollabs: number
  medianUnblockH: number | null
  topPrs?: TopPR[]
}

export interface TopPR {
  number: number
  title: string
}

export interface CollectStatus {
  status: 'running' | 'done' | 'error'
  message: string
  prCount?: number
  engineerCount?: number
}
```

---

## Step 2 — Database (`src/lib/db.ts`)

Use `better-sqlite3`. Synchronous — fine for API routes in Next.js.

```typescript
import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'impact.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    initSchema(_db)
  }
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pr_directories (
      pr_number     INTEGER PRIMARY KEY,
      author_login  TEXT    NOT NULL,
      merged_at     TEXT    NOT NULL,
      directories   TEXT    NOT NULL,   -- JSON array
      linked_issues TEXT    NOT NULL,   -- JSON array of ints
      labels        TEXT    NOT NULL    -- JSON array of strings
    );

    CREATE TABLE IF NOT EXISTS pr_reviews (
      pr_number             INTEGER NOT NULL,
      reviewer              TEXT    NOT NULL,
      reviewed_at           TEXT    NOT NULL,
      opened_at             TEXT,
      merged_at             TEXT,
      hours_open_to_review  REAL,
      hours_review_to_merge REAL,
      review_state          TEXT    NOT NULL,
      PRIMARY KEY (pr_number, reviewer, reviewed_at)
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON pr_reviews(reviewer);
    CREATE INDEX IF NOT EXISTS idx_reviews_pr       ON pr_reviews(pr_number);
    CREATE INDEX IF NOT EXISTS idx_dirs_author      ON pr_directories(author_login);
  `)
}
```

---

## Step 3 — Data collection (`src/lib/collect.ts`)

**Mirrors `reference/collect.py` exactly.** Read that file to understand the logic.
Translate the Python to TypeScript. Key points:

### GraphQL query (identical to Python)

```graphql
query($cursor: String) {
  repository(owner: "PostHog", name: "posthog") {
    pullRequests(
      first: 100
      after: $cursor
      states: MERGED
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        mergedAt
        createdAt
        author   { login }
        bodyText
        labels   (first: 20) { nodes { name } }
        files    (first: 100) { nodes { path } }
        reviews  (first: 50) {
          nodes {
            author      { login }
            submittedAt
            state
          }
        }
      }
    }
  }
}
```

### collect() function signature

```typescript
export async function collect(days = 90): Promise<{
  prCount: number
  reviewCount: number
  engineerCount: number
}> {
  // 1. Compute SINCE date
  // 2. Cursor-paginate GraphQL until mergedAt < SINCE
  // 3. For each PR: write to pr_directories
  // 4. For each review: write to pr_reviews
  // 5. Return counts
}
```

### Environment

Read `GITHUB_TOKEN` from `process.env.GITHUB_TOKEN`.
GraphQL endpoint: `https://api.github.com/graphql`
Headers: `{ Authorization: 'Bearer TOKEN', 'Content-Type': 'application/json' }`

### CLOSES regex (identical to Python)

```typescript
const CLOSES_RE = /(?:closes|fixes|resolves)\s+#(\d+)/gi
```

### Sleep between pages

```typescript
await new Promise(r => setTimeout(r, 200))
```

---

## Step 4 — Scoring (`src/lib/score.ts`)

**Mirrors `reference/score.py` exactly.** Read that file to understand the logic.
Translate Python to TypeScript. Key points:

### Label classification (identical to Python)

```typescript
const HIGH_INTENT_EXACT    = new Set(['bug', 'enhancement', 'experiment'])
const HIGH_INTENT_PREFIXES = ['feature/']
const LOW_INTENT_EXACT     = new Set(['dependencies', 'deploy', 'ci', 'chore', 'backlog', 'bot-ips', 'codex', 'canary'])

function labelWeight(label: string): number {
  const lo = label.toLowerCase()
  if (HIGH_INTENT_EXACT.has(lo) || HIGH_INTENT_PREFIXES.some(p => lo.startsWith(p))) return 1.0
  if (LOW_INTENT_EXACT.has(lo)) return 0.0
  return 0.5
}
```

### Acceleration — critical logic

```typescript
// For each PR, find the last APPROVED review before merge
// If hours_review_to_merge <= 48 AND >= 0, credit the reviewer
const UNBLOCK_WINDOW_H = 48
```

### score() function signature

```typescript
export function score(minPrs = 3, topN = 10): EngineerScore[] {
  // 1. Read pr_directories — accumulate dirs, linked_issues, labels per author
  // 2. Read pr_reviews — accumulate collaborators, acceleration events
  // 3. Compute raw scores
  // 4. Normalise 0–100
  // 5. Compute composite: breadth×0.35 + accel×0.35 + substance×0.30
  // 6. Filter to authors with >= minPrs PRs
  // 7. Sort descending, slice to topN, assign rank
  // 8. Return EngineerScore[]
}
```

---

## Step 5 — API routes

### `GET /api/scores` (`src/app/api/scores/route.ts`)

```typescript
import { NextResponse } from 'next/server'
import { score } from '@/lib/score'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const scores = score(3, 10)
    return NextResponse.json(scores)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

### `POST /api/collect` (`src/app/api/collect/route.ts`)

```typescript
import { NextResponse } from 'next/server'
import { collect } from '@/lib/collect'

export async function POST() {
  try {
    const result = await collect(90)
    return NextResponse.json({ status: 'done', ...result })
  } catch (err) {
    return NextResponse.json({ status: 'error', message: String(err) }, { status: 500 })
  }
}
```

---

## Step 6 — Design system

### Aesthetic direction: **precision tool**

Inspired by Ramp's financial density, Vercel's developer clarity, and Notion's quiet confidence.
Light mode. Everything earns its place. Numbers are heroes. PostHog orange as the single accent.

**NOT:** gradients, glassmorphism, purple AI palette, rounded pill everything, shadows everywhere.
**YES:** 1px borders, monospace numbers, warm off-white surfaces, precise spacing, purposeful hierarchy.

### `globals.css` — design tokens + ShadCN overrides

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Base */
  --background:    #FAFAFA;
  --surface:       #FFFFFF;
  --surface-2:     #F4F4F4;
  --border:        #E4E4E4;
  --border-strong: #C8C8C8;

  /* Text */
  --foreground:    #0C0C0C;
  --muted:         #6B6B6B;
  --subtle:        #A8A8A8;

  /* Accent — PostHog orange */
  --accent:        #F54E00;
  --accent-hover:  #D94400;
  --accent-subtle: #FEF0EB;
  --accent-border: #FBBFA0;

  /* Semantic */
  --success:       #16A34A;
  --success-subtle:#F0FDF4;

  /* Typography */
  --font-sans: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'DM Mono', 'Fira Code', monospace;

  /* shadcn variable overrides */
  --radius: 6px;
  --primary: 21 90% 48%;            /* HSL for PostHog orange */
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 96%;
  --secondary-foreground: 0 0% 5%;
  --muted: 0 0% 96%;
  --muted-foreground: 0 0% 42%;
  --accent: 21 90% 48%;
  --accent-foreground: 0 0% 100%;
  --border: 0 0% 89%;
  --ring: 21 90% 48%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 5%;
}

html, body { font-family: var(--font-sans); background: var(--background); }

/* Mono numbers — apply to any numeric display */
.mono { font-family: var(--font-mono); }

/* Subtle rule separator used throughout */
.rule { border-top: 1px solid var(--border); }
```

### `tailwind.config.ts`

Extend with the design tokens above. Add `fontFamily: { sans: ['DM Sans', ...], mono: ['DM Mono', ...] }`.

### `components.json` (ShadCN config)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

---

## Step 7 — Layout

Single viewport. No outer scroll. `height: 100dvh`.

```
┌──────────────────────────────────────────────────────────────────┐
│ HEADER  44px                                                      │
│ PostHog Impact          90d · 847 PRs · 43 engineers             │
├──────────────┬───────────────────────────────────────────────────┤
│              │  HERO ROW                                          │
│  RANK LIST   │  engineer name          84.2 composite            │
│  220px       │                                                    │
│              │  METRICS (3 rows)                                  │
│  #1  name    │  B  ███████░░  81.0   7 dirs · 22 collabs         │
│  #2  name    │  A  █████░░░░  67.2   3.2h median · 18 reviews    │
│  #3  name    │  S  ████████░  88.5   34 PRs · 71% intent         │
│  #4  name    │                                                    │
│  #5  name    ├───────────────────────────────────────────────────┤
│              │  SCATTER PLOT (Recharts)                           │
│              │  X: Breadth  Y: Acceleration  size: Substance      │
│              │  All engineers plotted. Click dot = select eng.    │
│              │                                                    │
│              │  METHODOLOGY accordion (collapsed)                 │
└──────────────┴───────────────────────────────────────────────────┘
```

---

## Step 8 — Components

### `RankList.tsx`

- Each row: rank number (mono, muted) + login (sans 500) + composite (mono, accent)
- Selected: left border 2px accent, background accent-subtle
- Hover: background surface-2
- No avatars. Text only. 1px separator between rows.

### `DetailPanel.tsx`

Top: hero row with engineer name (22px, DM Sans 600) and composite score (52px, DM Mono 600, accent).
Below: `MetricBar` for each of B / A / S.
Below: separator + `ImpactScatter`.
Bottom: `MethodologyAccordion`.

### `MetricBar.tsx`

```
B   Breadth       ─────────────────░░░░  81.0   7 dirs · 22 collaborators
```

- Letter label: mono 10px uppercase muted
- Name: sans 12px uppercase tracking-wide muted
- Bar: `<div>` 3px height, no border-radius, accent fill
- Score: mono 600 16px
- Detail string: mono 11px muted

### `ImpactScatter.tsx` — RECHARTS SCATTER CHART

**This is the key visualisation.**

```typescript
import {
  ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
```

**Data:** all engineers from the scores array (not just top 5 — pass full dataset to this component
via a separate `useScores({ topN: 20 })` call or extend the API).

**Axes:**
- X: `breadth` (0–100), label "Breadth →"
- Y: `acceleration` (0–100), label "Acceleration →"

**Dot styling:**
- Selected engineer: fill `#F54E00`, stroke none, radius 8
- Others: fill `#E4E4E4`, stroke `#C8C8C8`, stroke-width 1, radius 5
- On hover (non-selected): fill `#C8C8C8`

**Size:** `r` prop = `4 + (substance / 100) * 6` — larger dots = higher substance score

**Click:** clicking a dot calls `onSelect(login)` which updates parent selected state

**Grid:** `CartesianGrid` with `stroke="#E4E4E4"` and `strokeDasharray="4 4"`. 
Add vertical and horizontal reference lines at x=50, y=50 to create quadrants.
Label the quadrants in the corners with 10px muted text:
- top-right: "High Breadth · Fast"
- top-left: "Focused · Fast"
- bottom-right: "High Breadth · Slow"
- bottom-left: "Focused · Slow"

**Custom tooltip:**
```tsx
<div className="bg-white border border-border rounded px-3 py-2 shadow-sm">
  <div className="font-mono text-xs font-medium">{payload.login}</div>
  <div className="font-mono text-xs text-muted-foreground">
    B {payload.breadth.toFixed(0)} · A {payload.acceleration.toFixed(0)} · S {payload.substance.toFixed(0)}
  </div>
</div>
```

**Chart height:** 200px inside the right panel.

### `MethodologyAccordion.tsx`

ShadCN `Accordion` with customised trigger (no chevron icon from lucide — use plain `▾` text rotated via CSS).
Three items: Breadth, Acceleration, Substance.
Body text: 12px, muted, line-height 1.7, DM Sans.
Border-top only. No card wrapper.

---

## Step 9 — Data fetching (`src/hooks/useScores.ts`)

Use `swr` for client-side fetching with revalidation.

```typescript
import useSWR from 'swr'
import type { EngineerScore } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useScores() {
  const { data, error, isLoading } = useSWR<EngineerScore[]>('/api/scores', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000
  })
  return { scores: data ?? [], error, isLoading }
}
```

---

## Step 10 — `package.json`

```json
{
  "name": "posthog-impact",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "collect": "npx ts-node -e \"require('./src/lib/collect').collect().then(console.log)\""
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "better-sqlite3": "^9.4.3",
    "recharts": "^2.12.0",
    "swr": "^2.2.5",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "@radix-ui/react-accordion": "^1.1.2",
    "lucide-react": "^0.378.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "autoprefixer": "^10.0.1",
    "postcss": "^8",
    "tailwindcss": "^3.4.0",
    "typescript": "^5"
  }
}
```

---

## Step 11 — Run sequence

```bash
# 1. Install
npm install

# 2. Set env
echo "GITHUB_TOKEN=ghp_xxx" > .env.local

# 3. Collect data (calls GitHub GraphQL, ~2 min, ~13 API calls)
#    Trigger via API after server starts, OR run script directly:
curl -X POST http://localhost:3000/api/collect

# 4. Run dev server
npm run dev
# Open http://localhost:3000

# 5. Production
npm run build && npm start
```

**First load:** if `impact.db` doesn't exist or is empty, the dashboard shows "No data yet."
with a button that calls `POST /api/collect`.

---

## Definition of done

- [ ] `npm run dev` starts without errors
- [ ] `POST /api/collect` runs to completion, populates `impact.db`
- [ ] `GET /api/scores` returns ≥ 5 engineers with all score fields
- [ ] Dashboard renders top 5 engineers in rank list
- [ ] Clicking an engineer updates the detail panel
- [ ] All three metric bars render with correct scores and detail strings
- [ ] Scatter plot renders with all scored engineers as dots
- [ ] Clicking a dot in the scatter selects that engineer
- [ ] Selected engineer is highlighted orange in scatter, others neutral
- [ ] Methodology accordion opens and closes
- [ ] Full page load under 3 seconds after data is collected
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No console errors in browser
- [ ] Layout fits a 1440×900 laptop viewport without outer scrollbars

---

## Reference implementations

`reference/collect.py` and `reference/score.py` are the authoritative Python
implementations. Every data transformation, label classification rule, scoring
formula, and edge case handling in the TypeScript must match these exactly.

When in doubt: Python is the spec. TypeScript is the implementation.

---

## Implementation notes — actual state vs. spec

These notes capture where the live code diverges from or extends the spec above.

### What's fully implemented
All files from the project structure exist and are wired up:
`src/lib/{db,collect,score,types}.ts`, all API routes, all components, `useScores` hook.

### Divergences from spec

**`src/lib/types.ts`**
- `CollectStatus` (spec) → renamed `CollectResult` in implementation
- Extra types added: `PrDirectoryRow`, `PrReviewRow` (DB row shapes used by `score.ts`)

**`src/lib/score.ts`**
- `topPrs` field on `EngineerScore` is never populated (always `undefined`) — scoring logic doesn't fetch PR titles
- `score.py` has `LOW_INTENT_PREFIXES = ("chore",)` for prefix-matching chore/* labels — **TypeScript implementation is missing this prefix check**; only `LOW_INTENT_EXACT` is checked

**`src/hooks/useScores.ts`**
- Extended beyond spec: `useScores(topN?)` accepts a topN param; `useAllScores()` helper exported (calls `useScores(50)`)

**`src/app/api/scores/route.ts`**
- Extended beyond spec: supports `?top=N&minPrs=N` query params passed through to `score()`

**`src/components/ImpactScatter.tsx`**
- Quadrant labels differ from spec: uses "Wide · Fast / Focused · Fast / Wide · Slow / Focused · Slow" instead of "High Breadth · Fast" etc.
- Uses a custom `<circle>` SVG element (via `shape` prop) rather than Recharts `Cell` — this is the correct approach for click handling

**`src/components/MethodologyAccordion.tsx`**
- Implemented with plain React `useState` (two-level accordion) rather than Radix `Accordion` — no shadcn dependency used

**`package.json`**
- `collect` script from spec is absent; replaced with `typecheck: tsc --noEmit`
- Missing files from spec's project structure: `next.config.ts`, `src/components/ui/` (no shadcn primitives scaffolded)

### Known gaps / open work
- No `src/components/ui/` primitives — components use raw Tailwind/inline styles instead of ShadCN wrappers; works fine in practice

### Substance scoring — label fallback to conventional-commit title parsing
PostHog's GitHub labels are sparse (71% of PRs unlabelled) and the few that exist (`stamphog`, `team/*`, `update-snapshots`) all fall through to 0.5 neutral. This makes substance a flat metric where every engineer scores exactly 0.500.

**Fix applied in `score.ts`:** when labels are absent or all-neutral, `prIntent()` parses the conventional-commit prefix from the PR title:
- `feat/fix/perf/security` → 1.0 (high intent)
- `chore/ci/build/style/release/revert` → 0.0 (low intent)
- `refactor/docs/test` → 0.5 (neutral)

This produces real variation (0.0–1.0) matching what the label system was designed to capture. Diverges from `score.py` which has no title fallback.

### Resolved gaps (previously open)
- `topPrs` now populated — `title` stored in `pr_directories` (with automatic migration for existing DBs), top 3 PRs by intent score returned per engineer
- `chore/*` label prefix now classified as low-intent via `LOW_INTENT_PREFIXES` (matches `score.py`)
- `next.config.ts` exists with webpack config externalising `better-sqlite3` for SSR
- Quadrant labels corrected to "High Breadth · Fast / Focused · Fast / High Breadth · Slow / Focused · Slow"
