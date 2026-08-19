import { db } from '../db/db'
import { ROOT, type Block } from '../db/types'
import { buildTree, flattenTree, type Tree } from './tree'
import { computeInheritance, matchesCategoryFilter, type CategoryAssignment } from './inherit'
import { normalizeSearch } from './normalize'

/**
 * Indeks pencarian lintas dokumen.
 *
 * Kategori WARISAN tidak bisa dihitung dari subtree yang tampil di sini —
 * pencarian menjangkau seluruh dokumen. Jadi jalur kedua yang dipakai: bangun
 * pohon tiap dokumen, lalu satu pass pre-order menurunkan kategori dari leluhur
 * ke keturunan (aturan yang sama persis dengan editor, kode yang sama:
 * `computeInheritance`).
 */

export interface SearchIndex {
  blocks: Block[]
  byId: Map<string, Block>
  categories: Map<string, CategoryAssignment>
  tagsByBlock: Map<string, string[]>
  allTags: string[]
  allCategories: string[]
  documentTitles: Map<string, string>
  trees: Map<string, Tree>
}

export async function buildSearchIndex(): Promise<SearchIndex> {
  const [blocks, blockCategories, categoryRows, blockTags, tagRows, documents] =
    await Promise.all([
      db.blocks.toArray(),
      db.block_categories.toArray(),
      db.categories.toArray(),
      db.block_tags.toArray(),
      db.tags.toArray(),
      db.documents.toArray(),
    ])

  const live = blocks.filter((b) => !b.deleted_at)
  const categoryPathById = new Map(
    categoryRows.filter((c) => !c.deleted_at).map((c) => [c.id, c.path]),
  )
  const tagNameById = new Map(tagRows.filter((t) => !t.deleted_at).map((t) => [t.id, t.name]))

  const directByBlock = new Map<string, string[]>()
  for (const row of blockCategories) {
    if (row.deleted_at) continue
    const path = categoryPathById.get(row.category_id)
    if (!path) continue
    const list = directByBlock.get(row.block_id)
    if (list) {
      if (!list.includes(path)) list.push(path)
    } else directByBlock.set(row.block_id, [path])
  }

  const tagsByBlock = new Map<string, string[]>()
  for (const row of blockTags) {
    if (row.deleted_at) continue
    const name = tagNameById.get(row.tag_id)
    if (!name) continue
    const list = tagsByBlock.get(row.block_id)
    if (list) {
      if (!list.includes(name)) list.push(name)
    } else tagsByBlock.set(row.block_id, [name])
  }

  // Satu pass pewarisan per dokumen.
  const byDocument = new Map<string, Block[]>()
  for (const block of live) {
    const list = byDocument.get(block.document_id)
    if (list) list.push(block)
    else byDocument.set(block.document_id, [block])
  }

  const categories = new Map<string, CategoryAssignment>()
  const trees = new Map<string, Tree>()
  for (const [documentId, documentBlocks] of byDocument) {
    const tree = buildTree(documentBlocks)
    trees.set(documentId, tree)
    // `flattenTree` di sini sengaja mengabaikan collapse: pencarian harus
    // melihat blok yang sedang tersembunyi juga.
    const nodes = flattenTree(
      buildTree(documentBlocks.map((b) => ({ ...b, is_collapsed: 0 as const }))),
      ROOT,
    )
    for (const [id, assignment] of computeInheritance(nodes, directByBlock)) {
      categories.set(id, assignment)
    }
  }

  return {
    blocks: live,
    byId: new Map(live.map((b) => [b.id, b])),
    categories,
    tagsByBlock,
    allTags: [...tagNameById.values()].sort(),
    allCategories: [...categoryPathById.values()].sort(),
    documentTitles: new Map(
      documents.filter((d) => !d.deleted_at).map((d) => [d.id, d.title]),
    ),
    trees,
  }
}

export type FilterMode = 'AND' | 'OR'

export interface SearchFilters {
  query: string
  tags: string[]
  categories: string[]
  mode: FilterMode
  /** Ikutkan kategori warisan saat memfilter (default true). */
  includeInherited: boolean
  promotedOnly: boolean
  ayatOnly: boolean
  /**
   * Hanya bullet bertanda yang BELUM dijadikan blok — layar "Kandidat" lama,
   * kini hidup sebagai chip saring di sini. Predikatnya dipakai bersama
   * `candidateBlocks()` supaya keduanya tidak bisa berbeda diam-diam.
   */
  candidatesOnly: boolean
}

export const EMPTY_FILTERS: SearchFilters = {
  query: '',
  tags: [],
  categories: [],
  mode: 'AND',
  includeInherited: true,
  promotedOnly: false,
  ayatOnly: false,
  candidatesOnly: false,
}

export function effectivePaths(
  assignment: CategoryAssignment | undefined,
  includeInherited: boolean,
): string[] {
  if (!assignment) return []
  return includeInherited ? [...assignment.direct, ...assignment.inherited] : assignment.direct
}

/**
 * Bullet yang punya tag / kategori langsung / ayat, tapi BELUM dijadikan blok.
 * Satu definisi, dipakai oleh chip saring di Cari dan oleh `candidateBlocks()`.
 */
export function isCandidate(block: Block, index: SearchIndex): boolean {
  if (block.is_promoted) return false
  const tags = index.tagsByBlock.get(block.id) ?? []
  const assignment = index.categories.get(block.id) ?? { direct: [], inherited: [] }
  return tags.length > 0 || assignment.direct.length > 0 || block.block_type === 'ayat'
}

function matchesFilters(
  block: Block,
  index: SearchIndex,
  filters: SearchFilters,
  needle: string,
): boolean {
  if (filters.promotedOnly && !block.is_promoted) return false
  if (filters.ayatOnly && block.block_type !== 'ayat') return false
  if (filters.candidatesOnly && !isCandidate(block, index)) return false

  if (needle.length > 0 && !block.search_norm.includes(needle)) return false

  const hasTagFilter = filters.tags.length > 0
  const hasCategoryFilter = filters.categories.length > 0
  if (!hasTagFilter && !hasCategoryFilter) return true

  const blockTags = index.tagsByBlock.get(block.id) ?? []
  const paths = effectivePaths(index.categories.get(block.id), filters.includeInherited)

  const tagHits = filters.tags.filter((tag) => blockTags.includes(tag))
  // Filter `[dakwah]` otomatis menyertakan seluruh turunannya (brief §2.5).
  const categoryHits = filters.categories.filter((filter) =>
    paths.some((path) => matchesCategoryFilter(path, filter)),
  )

  if (filters.mode === 'AND') {
    return tagHits.length === filters.tags.length && categoryHits.length === filters.categories.length
  }
  return tagHits.length > 0 || categoryHits.length > 0
}

export interface BlockHit {
  block: Block
  documentTitle: string
  tags: string[]
  categories: CategoryAssignment
}

export function searchBlocks(
  index: SearchIndex,
  filters: SearchFilters,
  limit = 200,
): BlockHit[] {
  const needle = normalizeSearch(filters.query)
  const out: BlockHit[] = []
  for (const block of index.blocks) {
    if (!matchesFilters(block, index, filters, needle)) continue
    out.push({
      block,
      documentTitle: index.documentTitles.get(block.document_id) ?? 'Tanpa judul',
      tags: index.tagsByBlock.get(block.id) ?? [],
      categories: index.categories.get(block.id) ?? { direct: [], inherited: [] },
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Layar "Kandidat" (brief §2.4): bullet yang punya tag / kategori langsung /
 * ayat, tapi BELUM dipromosikan. Ini daftar tinjau berkala, bukan antrian kerja.
 */
export function candidateBlocks(index: SearchIndex, limit = 300): BlockHit[] {
  const out: BlockHit[] = []
  for (const block of index.blocks) {
    if (!isCandidate(block, index)) continue
    const tags = index.tagsByBlock.get(block.id) ?? []
    const assignment = index.categories.get(block.id) ?? { direct: [], inherited: [] }
    out.push({
      block,
      documentTitle: index.documentTitles.get(block.document_id) ?? 'Tanpa judul',
      tags,
      categories: assignment,
    })
    if (out.length >= limit) break
  }
  return out
}
