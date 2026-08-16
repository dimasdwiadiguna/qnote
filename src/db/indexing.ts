import { db } from './db'
import { newId, nowIso } from '../lib/id'
import { normalizeName, normalizeSearch } from '../lib/normalize'
import { categoryAncestry, parseContent, stripMarkup } from '../lib/parser'
import { enqueue, enqueueMany } from './outbox'
import { ROOT, type Block, type Category, type Tag } from './types'

/**
 * Materialisasi turunan dari `blocks.content`: `block_tags`, `block_categories`,
 * `block_links`.
 *
 * Kenapa dimaterialisasi dan bukan dihitung saat baca: filter dan backlink harus
 * lewat indeks, bukan memindai teks semua blok. Yang TIDAK dimaterialisasi
 * adalah kategori WARISAN — itu computed saat baca (lihat lib/inherit.ts),
 * supaya memindahkan bullet ke parent lain langsung benar tanpa backfill.
 */

/** Judul blok untuk target `[[wiki-link]]` dan tampilan ringkas. */
export function blockTitle(block: Pick<Block, 'content'>): string {
  return stripMarkup(block.content)
}

export function blockTitleKey(block: Pick<Block, 'content'>): string {
  return normalizeName(blockTitle(block))
}

// ── tags ──────────────────────────────────────────────────────────────────────

async function ensureTag(name: string): Promise<Tag> {
  const existing = await db.tags.where('name').equals(name).first()
  if (existing) {
    if (existing.deleted_at) {
      const revived: Tag = { ...existing, deleted_at: null, updated_at: nowIso() }
      await db.tags.put(revived)
      await enqueue('tags', revived.id)
      return revived
    }
    return existing
  }
  const now = nowIso()
  const tag: Tag = { id: newId(), name, created_at: now, updated_at: now, deleted_at: null }
  await db.tags.put(tag)
  await enqueue('tags', tag.id)
  return tag
}

// ── categories (pohon) ────────────────────────────────────────────────────────

/**
 * Membuat seluruh rantai kategori untuk sebuah path dan mengembalikan node
 * terdalam. `[dakwah/manhaj]` membuat `dakwah` lebih dulu bila belum ada.
 */
export async function ensureCategoryPath(path: string): Promise<Category | null> {
  const ancestry = categoryAncestry(path)
  let parentId = ROOT
  let node: Category | null = null
  for (const segment of ancestry) {
    const existing = await db.categories.where('path').equals(segment).first()
    if (existing) {
      node = existing
      if (existing.deleted_at) {
        node = { ...existing, deleted_at: null, updated_at: nowIso() }
        await db.categories.put(node)
        await enqueue('categories', node.id)
      }
    } else {
      const now = nowIso()
      const parts = segment.split('/')
      node = {
        id: newId(),
        name: parts[parts.length - 1] as string,
        parent_id: parentId,
        path: segment,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      await db.categories.put(node)
      await enqueue('categories', node.id)
    }
    parentId = node.id
  }
  return node
}

// ── wiki-link resolution ──────────────────────────────────────────────────────

/**
 * Peta judul → id untuk blok yang DIPROMOSIKAN. Hanya blok promoted yang boleh
 * jadi target `[[wiki-link]]` (brief §2.4).
 */
async function promotedTitleMap(): Promise<Map<string, string>> {
  const promoted = await db.blocks.where('is_promoted').equals(1).toArray()
  const map = new Map<string, string>()
  for (const block of promoted) {
    if (block.deleted_at) continue
    const key = blockTitleKey(block)
    if (key && !map.has(key)) map.set(key, block.id)
  }
  return map
}

// ── reindex satu blok ─────────────────────────────────────────────────────────

async function syncJoinRows<T extends { id: string; deleted_at: string | null }>(
  table: 'block_tags' | 'block_categories' | 'block_links',
  existing: T[],
  desiredKeys: string[],
  keyOf: (row: T) => string,
  make: (key: string) => T,
): Promise<void> {
  const now = nowIso()
  const desired = new Set(desiredKeys)
  const touched: string[] = []
  const puts: T[] = []

  for (const row of existing) {
    const key = keyOf(row)
    const shouldExist = desired.has(key)
    if (shouldExist && row.deleted_at) {
      puts.push({ ...row, deleted_at: null, updated_at: now } as T)
      touched.push(row.id)
    } else if (!shouldExist && !row.deleted_at) {
      puts.push({ ...row, deleted_at: now, updated_at: now } as T)
      touched.push(row.id)
    }
    desired.delete(key)
  }

  for (const key of desired) {
    const row = make(key)
    puts.push(row)
    touched.push(row.id)
  }

  if (puts.length === 0) return
  // @ts-expect-error — tiga tabel join punya bentuk berbeda tapi operasi identik.
  await db[table].bulkPut(puts)
  await enqueueMany(table, touched)
}

/**
 * Menyelaraskan seluruh baris turunan untuk satu blok dengan isi `content`-nya.
 * Dipanggil di dalam transaksi yang sama dengan penulisan `content`, supaya
 * join table tidak pernah tertinggal.
 */
export async function reindexBlock(blockId: string): Promise<void> {
  const block = await db.blocks.get(blockId)
  if (!block) return

  const now = nowIso()
  const parsed = block.deleted_at
    ? { tags: [], categories: [], links: [] }
    : parseContent(block.content)

  // ── tags ──
  const tagIds: string[] = []
  for (const name of parsed.tags) {
    const tag = await ensureTag(name)
    tagIds.push(tag.id)
  }
  const existingTags = await db.block_tags.where('block_id').equals(blockId).toArray()
  await syncJoinRows(
    'block_tags',
    existingTags,
    tagIds,
    (row) => row.tag_id,
    (tag_id) => ({
      id: newId(),
      block_id: blockId,
      tag_id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }),
  )

  // ── categories ──
  const categoryIds: string[] = []
  for (const path of parsed.categories) {
    const category = await ensureCategoryPath(path)
    if (category) categoryIds.push(category.id)
  }
  const existingCategories = await db.block_categories
    .where('block_id')
    .equals(blockId)
    .toArray()
  await syncJoinRows(
    'block_categories',
    existingCategories,
    categoryIds,
    (row) => row.category_id,
    (category_id) => ({
      id: newId(),
      block_id: blockId,
      category_id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }),
  )

  // ── links ──
  const targets: string[] = []
  if (parsed.links.length > 0) {
    const titles = await promotedTitleMap()
    for (const value of parsed.links) {
      const targetId = titles.get(value)
      if (targetId && targetId !== blockId) targets.push(targetId)
    }
  }
  const existingLinks = await db.block_links.where('from_block_id').equals(blockId).toArray()
  await syncJoinRows(
    'block_links',
    existingLinks,
    targets,
    (row) => row.to_block_id,
    (to_block_id) => ({
      id: newId(),
      from_block_id: blockId,
      to_block_id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }),
  )
}

/**
 * Setelah sebuah blok dipromosikan / dibatalkan promosinya / judulnya berubah,
 * link yang MENUJU blok itu bisa berubah status. Memindai blok yang mengandung
 * `[[` saja — subset kecil — lalu reindex hanya yang menyebut judul terkait.
 */
export async function reindexIncomingLinks(changedTitles: readonly string[]): Promise<void> {
  const titles = new Set(changedTitles.filter(Boolean))
  if (titles.size === 0) return
  const candidates = await db.blocks.filter((b) => b.content.includes('[[')).toArray()
  for (const candidate of candidates) {
    if (candidate.deleted_at) continue
    const { links } = parseContent(candidate.content)
    if (links.some((value) => titles.has(value))) {
      await reindexBlock(candidate.id)
    }
  }
}

export function searchNormFor(content: string): string {
  return normalizeSearch(stripMarkup(content))
}
