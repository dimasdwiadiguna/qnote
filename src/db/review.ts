import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'
import { db } from './db'
import { newId, nowIso } from '../lib/id'
import { enqueue } from './outbox'
import type { DrillMode, ReviewState, ReviewTargetType } from './types'

/**
 * Penjadwalan FSRS. Penilaian MURNI self-rating (Again/Hard/Good/Easy) —
 * tidak ada evaluasi AI, tidak ada rekaman audio, tidak ada penilaian otomatis
 * (brief §7).
 *
 * Tiga mode dijadwalkan TERPISAH: satu ayat bisa punya tiga jadwal berbeda,
 * karena kunci `review_states` adalah `[mode + target_type + target_id]`.
 */

const scheduler = fsrs({ enable_fuzz: true })

export const GRADES: { grade: Grade; label: string; hint: string }[] = [
  { grade: Rating.Again, label: 'Lagi', hint: 'belum ingat' },
  { grade: Rating.Hard, label: 'Sulit', hint: 'ingat dengan susah' },
  { grade: Rating.Good, label: 'Bagus', hint: 'ingat' },
  { grade: Rating.Easy, label: 'Mudah', hint: 'lancar' },
]

function toCard(state: ReviewState): Card {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    ...(state.last_review ? { last_review: new Date(state.last_review) } : {}),
  } as Card
}

function fromCard(base: ReviewState, card: Card): ReviewState {
  return {
    ...base,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : null,
    updated_at: nowIso(),
  }
}

export function emptyReviewState(
  mode: DrillMode,
  targetType: ReviewTargetType,
  targetId: string,
): ReviewState {
  const card = createEmptyCard(new Date())
  const now = nowIso()
  return {
    id: newId(),
    mode,
    target_type: targetType,
    target_id: targetId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
}

export async function getOrCreateReviewState(
  mode: DrillMode,
  targetType: ReviewTargetType,
  targetId: string,
): Promise<ReviewState> {
  const existing = await db.review_states
    .where('[mode+target_type+target_id]')
    .equals([mode, targetType, targetId])
    .first()
  if (existing && !existing.deleted_at) return existing
  const created = emptyReviewState(mode, targetType, targetId)
  await db.review_states.put(created)
  await enqueue('review_states', created.id)
  return created
}

/** Menerapkan self-rating dan menjadwalkan ulang kartu. */
export async function gradeCard(state: ReviewState, grade: Grade): Promise<ReviewState> {
  const { card } = scheduler.next(toCard(state), new Date(), grade)
  const next = fromCard(state, card)
  await db.review_states.put(next)
  await enqueue('review_states', next.id)
  return next
}

/** Prakiraan interval per tombol, ditampilkan di bawah label rating. */
export function previewIntervals(state: ReviewState): Record<number, string> {
  const log = scheduler.repeat(toCard(state), new Date())
  const out: Record<number, string> = {}
  for (const { grade } of GRADES) {
    const item = log[grade]
    if (!item) continue
    out[grade] = humanizeUntil(item.card.due)
  }
  return out
}

function humanizeUntil(due: Date): string {
  const minutes = Math.round((due.getTime() - Date.now()) / 60000)
  if (minutes < 1) return 'sekarang'
  if (minutes < 60) return `${minutes} mnt`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} jam`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days} hr`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} bln`
  return `${(days / 365).toFixed(1)} th`
}

/**
 * Porsi kata yang disembunyikan pada cloze Arab bertahap (mode B).
 * Naik seiring stability: makin dikuasai, makin banyak yang ditutup.
 */
export function clozeRatio(state: ReviewState): number {
  const stability = Math.max(0, state.stability)
  if (state.reps === 0) return 0.2
  const ratio = 0.2 + 0.6 * (1 - Math.exp(-stability / 30))
  return Math.min(0.8, Math.max(0.2, ratio))
}

/**
 * Memilih indeks kata yang ditutup — DETERMINISTIK dari (targetId, level),
 * supaya tampilan tidak berubah-ubah dalam satu sesi belajar.
 */
export function clozeHiddenIndices(
  targetId: string,
  wordCount: number,
  ratio: number,
): Set<number> {
  const hideCount = Math.min(wordCount, Math.max(1, Math.round(wordCount * ratio)))
  const level = Math.round(ratio * 100)
  let seed = 2166136261
  const key = `${targetId}#${level}`
  for (let i = 0; i < key.length; i += 1) {
    seed ^= key.charCodeAt(i)
    seed = Math.imul(seed, 16777619) >>> 0
  }
  const order = Array.from({ length: wordCount }, (_, i) => i)
  // Fisher–Yates dengan PRNG ber-seed.
  for (let i = wordCount - 1; i > 0; i -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const j = seed % (i + 1)
    const tmp = order[i] as number
    order[i] = order[j] as number
    order[j] = tmp
  }
  return new Set(order.slice(0, hideCount))
}
