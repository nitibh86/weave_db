// src/app/api/collect/route.ts
import { NextResponse } from 'next/server'
import { collect } from '@/lib/collect'

export const dynamic = 'force-dynamic'
// Collection can take ~2 min — bump the timeout
export const maxDuration = 300

export async function POST(request: Request) {
  const body   = await request.json().catch(() => ({}))
  const days   = typeof body.days === 'number' ? body.days : 90

  try {
    const result = await collect(days)
    return NextResponse.json({ status: 'done', ...result })
  } catch (err) {
    console.error('[/api/collect]', err)
    return NextResponse.json({ status: 'error', message: String(err) }, { status: 500 })
  }
}
