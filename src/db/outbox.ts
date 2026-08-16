import { db } from './db'
import { nowIso } from '../lib/id'
import type { SyncTable } from './types'

/**
 * Outbox lokal: setiap perubahan pada tabel yang ikut sync dicatat di sini dan
 * dikirim saat online. Antrian ini TIDAK pernah memblokir UI — menulis ke sini
 * adalah bagian dari transaksi Dexie yang sama dengan perubahan datanya.
 */
export async function enqueue(table: SyncTable, rowId: string): Promise<void> {
  await db.outbox.add({ table, row_id: rowId, queued_at: nowIso() })
}

export async function enqueueMany(table: SyncTable, rowIds: readonly string[]): Promise<void> {
  if (rowIds.length === 0) return
  const queued_at = nowIso()
  await db.outbox.bulkAdd(rowIds.map((row_id) => ({ table, row_id, queued_at })))
}

/**
 * Jumlah perubahan yang belum terkirim, dihitung per baris unik — bukan per
 * entri antrian. Sepuluh keystroke pada satu bullet adalah satu perubahan.
 */
export async function pendingCount(): Promise<number> {
  const entries = await db.outbox.toArray()
  const unique = new Set(entries.map((e) => `${e.table}/${e.row_id}`))
  return unique.size
}

export interface OutboxBatch {
  /** Baris unik per tabel, urut sesuai SYNC_TABLES. */
  byTable: Map<SyncTable, Set<string>>
  /** Semua `seq` yang tercakup — dihapus setelah push sukses. */
  seqs: number[]
}

export async function takeBatch(limit = 2000): Promise<OutboxBatch> {
  const entries = await db.outbox.orderBy('seq').limit(limit).toArray()
  const byTable = new Map<SyncTable, Set<string>>()
  const seqs: number[] = []
  for (const entry of entries) {
    if (entry.seq !== undefined) seqs.push(entry.seq)
    let set = byTable.get(entry.table)
    if (!set) {
      set = new Set<string>()
      byTable.set(entry.table, set)
    }
    set.add(entry.row_id)
  }
  return { byTable, seqs }
}

export async function clearSeqs(seqs: readonly number[]): Promise<void> {
  if (seqs.length === 0) return
  await db.outbox.bulkDelete(seqs as number[])
}
