// src/app/api/scores/route.ts
import { NextResponse } from 'next/server'
import { score } from '@/lib/score'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const topN   = parseInt(searchParams.get('top')    ?? '10', 10)
  const minPrs = parseInt(searchParams.get('minPrs') ?? '3',  10)

  try {
    const scores = score(minPrs, topN)
    return NextResponse.json(scores)
  } catch (err) {
    console.error('[/api/scores]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
