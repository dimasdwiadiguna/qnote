import { db } from '../db/db'
import { AYAT_KEY, type Block, type DrillMode, type ReviewState } from '../db/types'
import { immediateNeighbours } from './tree'
import { matchesCategoryFilter } from './inherit'
import { effectivePaths, type SearchIndex } from './search'

/**
 * Membangun antrian drill harian dari ketiga mode.
 *
 * ATURAN KETERKAITAN MODE A (brief §7) — sengaja sempit:
 * sebuah ayat terkait dengan blok catatan bila
 *   (a) keduanya parent–child LANGSUNG (satu tingkat, arah mana pun), atau
 *   (b) ada `[[wiki-link]]` eksplisit di antara keduanya.
 * Kekerabatan lebih jauh TIDAK dihitung: ayat yang diletakkan di akar dokumen
 * akan menyeret seluruh isi dokumen jadi "terkait" dan membuat drill tak
 * bermakna.
 */

export interface AyatRef {
  surah: number
  number: number
}

export interface LinkGraph {
  outgoing: Map<string, string[]>
  incoming: Map<string, string[]>
}

export async function loadLinkGraph(): Promise<LinkGraph> {
  const rows = await db.block_links.toArray()
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const row of rows) {
    if (row.deleted_at) continue
    const out = outgoing.get(row.from_block_id)
    if (out) out.push(row.to_block_id)
    else outgoing.set(row.from_block_id, [row.to_block_id])
    const inc = incoming.get(row.to_block_id)
    if (inc) inc.push(row.from_block_id)
    else incoming.set(row.to_block_id, [row.from_block_id])
  }
  return { outgoing, incoming }
}

function asAyatRef(block: Block | undefined): AyatRef | null {
  if (!block || block.block_type !== 'ayat') return null
  if (block.ayat_surah === null || block.ayat_number === null) return null
  return { surah: block.ayat_surah, number: block.ayat_number }
}

/** Ayat yang terkait dengan sebuah blok, menurut aturan (a) dan (b) saja. */
export function relatedAyat(
  index: SearchIndex,
  links: LinkGraph,
  blockId: string,
): AyatRef[] {
  const block = index.byId.get(blockId)
  if (!block) return []
  const tree = index.trees.get(block.document_id)
  const found = new Map<string, AyatRef>()

  const consider = (candidate: Block | undefined): void => {
    const ref = asAyatRef(candidate)
    if (ref) found.set(AYAT_KEY(ref.surah, ref.number), ref)
  }

  // (a) parent–child langsung, arah mana pun.
  if (tree) {
    for (const neighbour of immediateNeighbours(tree, blockId)) consider(neighbour)
  }

  // (b) wiki-link eksplisit, arah mana pun.
  for (const targetId of links.outgoing.get(blockId) ?? []) consider(index.byId.get(targetId))
  for (const sourceId of links.incoming.get(blockId) ?? []) consider(index.byId.get(sourceId))

  return [...found.values()]
}

export interface DrillTarget {
  mode: DrillMode
  target_type: 'block' | 'ayat'
  target_id: string
}

export interface QueueOptions {
  modes: DrillMode[]
  /** Batasi ke kategori tertentu (termasuk turunannya). Kosong = semua. */
  category: string | null
  limit: number
}

export interface QueueCard extends DrillTarget {
  state: ReviewState | null
  /** null = kartu baru, belum pernah dijadwalkan. */
  dueAt: number | null
}

function passesCategory(index: SearchIndex, blockId: string, category: string | null): boolean {
  if (!category) return true
  const paths = effectivePaths(index.categories.get(blockId), true)
  return paths.some((path) => matchesCategoryFilter(path, category))
}

/** Semua target yang layak masuk drill, sebelum penjadwalan diperhitungkan. */
export function collectTargets(
  index: SearchIndex,
  links: LinkGraph,
  options: QueueOptions,
): DrillTarget[] {
  const targets: DrillTarget[] = []
  const ayatSeen = new Map<string, boolean>()

  for (const block of index.blocks) {
    if (block.block_type === 'ayat') {
      const ref = asAyatRef(block)
      if (!ref) continue
      const key = AYAT_KEY(ref.surah, ref.number)
      const allowed = passesCategory(index, block.id, options.category)
      // Satu ayat yang muncul di lima tempat tetap SATU kartu drill (brief §3).
      ayatSeen.set(key, (ayatSeen.get(key) ?? false) || allowed)
      continue
    }

    // Mode A hanya untuk blok yang DIPROMOSIKAN (brief §2.4).
    if (!block.is_promoted) continue
    if (!options.modes.includes('A')) continue
    if (!passesCategory(index, block.id, options.category)) continue
    if (relatedAyat(index, links, block.id).length === 0) continue
    targets.push({ mode: 'A', target_type: 'block', target_id: block.id })
  }

  for (const [key, allowed] of ayatSeen) {
    if (!allowed) continue
    if (options.modes.includes('B')) {
      targets.push({ mode: 'B', target_type: 'ayat', target_id: key })
    }
    if (options.modes.includes('C')) {
      targets.push({ mode: 'C', target_type: 'ayat', target_id: key })
    }
  }

  return targets
}

/**
 * Antrian harian: kartu jatuh tempo dari ketiga mode digabung, kartu baru
 * ditaruh setelahnya. Kartu baru sengaja TIDAK dibuatkan baris `review_states`
 * sampai benar-benar dinilai — supaya membuka layar drill tidak menulis ratusan
 * baris ke outbox.
 */
export async function buildQueue(
  index: SearchIndex,
  links: LinkGraph,
  options: QueueOptions,
): Promise<QueueCard[]> {
  const targets = collectTargets(index, links, options)
  if (targets.length === 0) return []

  const states = await db.review_states.toArray()
  const byKey = new Map<string, ReviewState>()
  for (const state of states) {
    if (state.deleted_at) continue
    byKey.set(`${state.mode}|${state.target_type}|${state.target_id}`, state)
  }

  const now = Date.now()
  const due: QueueCard[] = []
  const fresh: QueueCard[] = []

  for (const target of targets) {
    const state = byKey.get(`${target.mode}|${target.target_type}|${target.target_id}`) ?? null
    if (!state) {
      fresh.push({ ...target, state: null, dueAt: null })
      continue
    }
    const dueAt = Date.parse(state.due)
    if (dueAt <= now) due.push({ ...target, state, dueAt })
  }

  due.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  // Selang-seling mode supaya tidak 40 kartu cloze berturut-turut.
  return interleaveByMode([...due, ...fresh]).slice(0, options.limit)
}

function interleaveByMode(cards: QueueCard[]): QueueCard[] {
  const buckets = new Map<DrillMode, QueueCard[]>()
  for (const card of cards) {
    const bucket = buckets.get(card.mode)
    if (bucket) bucket.push(card)
    else buckets.set(card.mode, [card])
  }
  const out: QueueCard[] = []
  let remaining = cards.length
  while (remaining > 0) {
    for (const bucket of buckets.values()) {
      const next = bucket.shift()
      if (next) {
        out.push(next)
        remaining -= 1
      }
    }
  }
  return out
}

export interface QueueSummary {
  total: number
  byMode: Record<DrillMode, number>
}

export function summarize(cards: readonly QueueCard[]): QueueSummary {
  const byMode: Record<DrillMode, number> = { A: 0, B: 0, C: 0 }
  for (const card of cards) byMode[card.mode] += 1
  return { total: cards.length, byMode }
}
