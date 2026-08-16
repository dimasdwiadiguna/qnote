import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  Ayat,
  Block,
  BlockCategory,
  BlockLink,
  BlockTag,
  Category,
  Document,
  MetaEntry,
  OutboxEntry,
  ReviewState,
  SurahMeta,
  Tag,
} from './types'

/**
 * Sumber kebenaran aplikasi. Supabase hanya lapisan sync/backup di atas ini.
 *
 * Catatan indeks: `[parent_id+order_key]` adalah indeks terpenting — seluruh
 * render outline adalah range-scan anak per parent yang sudah terurut, tanpa
 * sort di memori. Itulah alasan `parent_id` memakai sentinel '' (lihat types.ts).
 */
export class QnoteDb extends Dexie {
  documents!: EntityTable<Document, 'id'>
  blocks!: EntityTable<Block, 'id'>
  tags!: EntityTable<Tag, 'id'>
  categories!: EntityTable<Category, 'id'>
  block_tags!: EntityTable<BlockTag, 'id'>
  block_categories!: EntityTable<BlockCategory, 'id'>
  block_links!: EntityTable<BlockLink, 'id'>
  review_states!: EntityTable<ReviewState, 'id'>
  /** Primary key majemuk `[surah+number]`. */
  ayat!: Table<Ayat, [number, number]>
  surahs!: EntityTable<SurahMeta, 'surah'>
  /** `seq` auto-increment, jadi baris baru disisipkan tanpa key. */
  outbox!: Table<OutboxEntry, number>
  meta!: EntityTable<MetaEntry, 'key'>

  constructor() {
    super('qnote')
    this.version(1).stores({
      documents: 'id, updated_at, order_key',
      blocks:
        'id, document_id, parent_id, [document_id+parent_id], [parent_id+order_key], ' +
        'is_promoted, block_type, updated_at, [ayat_surah+ayat_number], ' +
        '[document_id+is_promoted]',
      tags: 'id, &name, updated_at',
      categories: 'id, &path, parent_id, updated_at',
      block_tags: 'id, block_id, tag_id, [block_id+tag_id], updated_at',
      block_categories: 'id, block_id, category_id, [block_id+category_id], updated_at',
      block_links: 'id, from_block_id, to_block_id, [from_block_id+to_block_id], updated_at',
      review_states:
        'id, mode, due, target_id, [mode+target_type+target_id], [mode+due], updated_at',
      // Ayat: primary key majemuk, tidak pernah ikut sync.
      ayat: '[surah+number], surah',
      surahs: 'surah, name_squashed',
      outbox: '++seq, table, row_id, [table+row_id]',
      meta: 'key',
    })
  }
}

export const db = new QnoteDb()

// ── meta helpers ──────────────────────────────────────────────────────────────

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export const META = {
  seedProgress: 'seed:quran:lastSurah',
  seedDone: 'seed:quran:done',
  lastSyncedAt: 'sync:lastSyncedAt',
  lastDocumentId: 'ui:lastDocumentId',
  ayatCardsCollapsed: 'ui:ayatCardsCollapsed',
  conflictLog: 'sync:conflictLog',
} as const

/**
 * Minta storage persisten. Tanpa ini iOS Safari berhak mengosongkan IndexedDB
 * saat storage menipis — dan itu berarti kehilangan sumber kebenaran.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage) return false
  try {
    if (await navigator.storage.persisted()) return true
    if (typeof navigator.storage.persist !== 'function') return false
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}
