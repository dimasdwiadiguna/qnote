/**
 * Skema data. Bentuknya identik di Dexie dan di Postgres/Supabase — lihat
 * `supabase/schema.sql`. Tiga kompromi yang dibuat agar identik itu benar-benar
 * bisa dipegang (dicatat juga di DECISIONS.md):
 *
 *  1. `parent_id` memakai sentinel `''` untuk akar, bukan `null`.
 *     IndexedDB tidak bisa mengindeks `null`, jadi blok akar akan hilang dari
 *     indeks `[parent_id+order_key]` — indeks terpenting di app ini.
 *  2. Boolean disimpan `0 | 1`. IndexedDB tidak menerima boolean sebagai key.
 *  3. `deleted_at` selalu ada sebagai kolom, `null` saat hidup. Soft delete
 *     wajib: hard delete akan membangkitkan kembali baris terhapus saat sync.
 */

export type Iso = string
export type Flag = 0 | 1

/** Sentinel parent untuk blok di akar dokumen. */
export const ROOT = ''

export interface Timestamped {
  created_at: Iso
  updated_at: Iso
  deleted_at: Iso | null
}

export interface Document extends Timestamped {
  id: string
  title: string
  order_key: string
}

export type BlockType = 'text' | 'ayat'

export interface Block extends Timestamped {
  id: string
  document_id: string
  /** `ROOT` ('') bila blok berada di akar dokumen. */
  parent_id: string
  /** Fractional index (string, urut leksikografis). */
  order_key: string
  block_type: BlockType
  /**
   * Teks mentah termasuk penanda `#tag`, `[kategori]`, `[[wiki-link]]`.
   * Pada blok 'ayat' ini adalah ANOTASI user — bukan teks ayat. Teks Arab dan
   * terjemah selalu diambil dari tabel `ayat` lewat (ayat_surah, ayat_number).
   */
  content: string
  /** `content` ternormalisasi untuk pencarian; dihitung saat tulis. */
  search_norm: string
  is_promoted: Flag
  is_collapsed: Flag
  ayat_surah: number | null
  ayat_number: number | null
}

export interface Tag extends Timestamped {
  id: string
  /** Selalu lowercase. */
  name: string
}

export interface Category extends Timestamped {
  id: string
  /** Segmen terakhir saja, lowercase (`manhaj`). */
  name: string
  /** `ROOT` bila kategori tingkat atas. */
  parent_id: string
  /** Path penuh (`dakwah/manhaj`) — dimaterialisasi untuk lookup & filter turunan. */
  path: string
}

export interface BlockTag extends Timestamped {
  id: string
  block_id: string
  tag_id: string
}

export interface BlockCategory extends Timestamped {
  id: string
  block_id: string
  category_id: string
}

export interface BlockLink extends Timestamped {
  id: string
  from_block_id: string
  to_block_id: string
}

/** A: Tema→Ayat · B: Cloze Arab · C: Terjemah→Rujukan */
export type DrillMode = 'A' | 'B' | 'C'
export type ReviewTargetType = 'block' | 'ayat'

export interface ReviewState extends Timestamped {
  id: string
  mode: DrillMode
  target_type: ReviewTargetType
  /** block id, atau identitas ayat `"2:153"` untuk mode B & C. */
  target_id: string
  // ── field FSRS ──
  due: Iso
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  /** ts-fsrs State: 0 New · 1 Learning · 2 Review · 3 Relearning */
  state: number
  last_review: Iso | null
}

/** Read-only, data seed, tidak pernah ikut sync, tidak pernah diedit user. */
export interface Ayat {
  surah: number
  number: number
  arabic: string
  translation_id: string
  arabic_norm: string
  translation_norm: string
}

export interface SurahMeta {
  surah: number
  name_arabic: string
  name_latin: string
  name_id: string
  ayah_count: number
  /** `name_latin` diratakan untuk pencarian ("albaqarah"). */
  name_squashed: string
}

// ── Tabel lokal murni (tidak pernah ikut sync) ────────────────────────────────

export type SyncTable =
  | 'documents'
  | 'blocks'
  | 'tags'
  | 'categories'
  | 'block_tags'
  | 'block_categories'
  | 'block_links'
  | 'review_states'

export const SYNC_TABLES: readonly SyncTable[] = [
  'documents',
  'tags',
  'categories',
  'blocks',
  'block_tags',
  'block_categories',
  'block_links',
  'review_states',
] as const

export interface OutboxEntry {
  seq?: number
  table: SyncTable
  row_id: string
  queued_at: Iso
}

export interface MetaEntry {
  key: string
  value: unknown
}

export const AYAT_KEY = (surah: number, number: number): string => `${surah}:${number}`

export function parseAyatKey(key: string): { surah: number; number: number } | null {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(key)
  if (!match) return null
  const surah = Number(match[1])
  const number = Number(match[2])
  if (surah < 1 || surah > 114 || number < 1) return null
  return { surah, number }
}
