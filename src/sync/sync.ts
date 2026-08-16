import { db, getMeta, META, setMeta } from '../db/db'
import { clearSeqs, pendingCount, takeBatch } from '../db/outbox'
import { SYNC_TABLES, type SyncTable } from '../db/types'
import { getSupabase, isSupabaseConfigured } from './client'

/**
 * Sync dua arah dengan Supabase.
 *
 * Supabase adalah lapisan sync/backup lintas device, BUKAN sumber kebenaran
 * (brief §2.1). Karena itu:
 *  - tidak ada satu pun jalur di sini yang boleh memblokir UI;
 *  - kegagalan jaringan bukan error yang perlu diteriakkan, cukup status tenang;
 *  - konflik diselesaikan last-write-wins PER BARIS berbasis `updated_at`.
 */

export type SyncPhase = 'idle' | 'pushing' | 'pulling' | 'offline' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  pending: number
  lastSyncedAt: string | null
  lastError: string | null
  signedIn: boolean
}

export interface ConflictRecord {
  table: SyncTable
  row_id: string
  at: string
  reason: 'remote-newer' | 'clock-skew'
}

/** Toleransi clock skew: baris "dari masa depan" tidak boleh menang (risiko R8). */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

const listeners = new Set<(status: SyncStatus) => void>()
let current: SyncStatus = {
  phase: 'idle',
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
  signedIn: false,
}
let running = false

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener)
  listener(current)
  return () => listeners.delete(listener)
}

function emit(patch: Partial<SyncStatus>): void {
  current = { ...current, ...patch }
  for (const listener of listeners) listener(current)
}

export async function refreshStatus(): Promise<void> {
  const supabase = getSupabase()
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  emit({
    pending: await pendingCount(),
    lastSyncedAt: await getMeta<string | null>(META.lastSyncedAt, null),
    signedIn: Boolean(session),
    phase: navigator.onLine ? current.phase : 'offline',
  })
}

async function logConflict(record: ConflictRecord): Promise<void> {
  const log = await getMeta<ConflictRecord[]>(META.conflictLog, [])
  log.unshift(record)
  await setMeta(META.conflictLog, log.slice(0, 100))
}

export async function readConflictLog(): Promise<ConflictRecord[]> {
  return getMeta<ConflictRecord[]>(META.conflictLog, [])
}

// ── serialisasi lokal ↔ remote ────────────────────────────────────────────────

/**
 * Bentuk baris identik di kedua sisi kecuali satu hal: `user_id` hanya ada di
 * Postgres (untuk RLS). Boolean disimpan `0|1` dan `parent_id` akar disimpan ''
 * di KEDUA sisi — lihat DECISIONS.md D1/D2 — jadi tidak ada mapping tipe.
 */
function toRemote(row: Record<string, unknown>, userId: string): Record<string, unknown> {
  return { ...row, user_id: userId }
}

function fromRemote(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row }
  delete copy.user_id
  return copy
}

function tableOf(name: SyncTable) {
  return db[name]
}

// ── push ──────────────────────────────────────────────────────────────────────

async function pushOutbox(userId: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const batch = await takeBatch()
  if (batch.seqs.length === 0) return

  emit({ phase: 'pushing' })

  for (const table of SYNC_TABLES) {
    const ids = batch.byTable.get(table)
    if (!ids || ids.size === 0) continue
    const rows = (await (tableOf(table) as never as { bulkGet: (k: string[]) => Promise<unknown[]> })
      .bulkGet([...ids]))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => toRemote(row, userId))
    if (rows.length === 0) continue

    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
    if (error) throw new Error(`push ${table}: ${error.message}`)
  }

  await clearSeqs(batch.seqs)
}

// ── pull ──────────────────────────────────────────────────────────────────────

const PAGE = 500

async function pullTable(table: SyncTable, since: string): Promise<string | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  let cursor = since
  let newest: string | null = null

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(PAGE)
    if (error) throw new Error(`pull ${table}: ${error.message}`)
    const rows = (data ?? []) as Record<string, unknown>[]
    if (rows.length === 0) return newest

    const maxAcceptable = Date.now() + FUTURE_TOLERANCE_MS
    const local = tableOf(table) as never as {
      get: (key: unknown) => Promise<Record<string, unknown> | undefined>
      put: (row: unknown) => Promise<unknown>
    }

    for (const remote of rows) {
      const mapped = fromRemote(remote)
      const id = mapped.id as string
      const remoteUpdated = Date.parse(mapped.updated_at as string)

      if (Number.isFinite(remoteUpdated) && remoteUpdated > maxAcceptable) {
        await logConflict({ table, row_id: id, at: new Date().toISOString(), reason: 'clock-skew' })
        continue
      }

      const existing = await local.get(id)
      if (existing) {
        const localUpdated = Date.parse(existing.updated_at as string)
        // Last-write-wins per baris. Lokal yang lebih baru dipertahankan dan
        // akan menang saat push berikutnya.
        if (localUpdated >= remoteUpdated) continue
        await logConflict({
          table,
          row_id: id,
          at: new Date().toISOString(),
          reason: 'remote-newer',
        })
      }
      await local.put(mapped)
    }

    const last = rows[rows.length - 1]
    cursor = last?.updated_at as string
    newest = cursor
    if (rows.length < PAGE) return newest
  }
}

// ── orkestrasi ────────────────────────────────────────────────────────────────

export async function syncNow(): Promise<SyncStatus> {
  if (running) return current
  if (!isSupabaseConfigured) {
    emit({ phase: 'idle', lastError: null })
    return current
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    emit({ phase: 'offline' })
    return current
  }

  const supabase = getSupabase()
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  if (!session) {
    emit({ phase: 'idle', signedIn: false })
    return current
  }

  running = true
  try {
    await pushOutbox(session.user.id)

    emit({ phase: 'pulling' })
    const since = (await getMeta<string | null>(META.lastSyncedAt, null)) ?? '1970-01-01T00:00:00Z'
    // Urutan tabel mengikuti SYNC_TABLES: induk sebelum join row, supaya data
    // tidak pernah tampil setengah jadi di UI selagi pull berjalan.
    for (const table of SYNC_TABLES) {
      await pullTable(table, since)
    }

    const stamp = new Date().toISOString()
    await setMeta(META.lastSyncedAt, stamp)
    emit({ phase: 'idle', lastError: null, lastSyncedAt: stamp, signedIn: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ phase: 'error', lastError: message })
  } finally {
    running = false
    emit({ pending: await pendingCount() })
  }
  return current
}

/** Sinkron otomatis: saat online kembali, saat tab kembali aktif, dan berkala. */
export function startAutoSync(): () => void {
  const tick = (): void => {
    void syncNow()
  }
  const onOnline = (): void => {
    emit({ phase: 'idle' })
    tick()
  }
  const onOffline = (): void => emit({ phase: 'offline' })
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') tick()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const interval = window.setInterval(tick, 60_000)
  void refreshStatus()
  tick()

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(interval)
  }
}
