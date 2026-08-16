import { describe, expect, it } from 'vitest'
import { ROOT, type Block } from '../db/types'
import { buildTree } from './tree'
import { collectTargets, relatedAyat, type LinkGraph } from './drillQueue'
import type { SearchIndex } from './search'

/**
 * Aturan keterkaitan Mode A (brief §7) — bagian yang paling mudah salah.
 * Kekerabatan lebih jauh dari SATU tingkat tidak boleh dihitung: ayat di akar
 * dokumen akan menyeret seluruh dokumen jadi "terkait" dan drill kehilangan makna.
 */

let counter = 0
function block(id: string, parent: string, patch: Partial<Block> = {}): Block {
  counter += 1
  const now = new Date(2026, 0, 1, 0, 0, counter).toISOString()
  return {
    id,
    document_id: 'doc',
    parent_id: parent,
    order_key: `a${counter}`,
    block_type: 'text',
    content: '',
    search_norm: '',
    is_promoted: 0,
    is_collapsed: 0,
    ayat_surah: null,
    ayat_number: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...patch,
  }
}

function ayatBlock(id: string, parent: string, surah: number, number: number): Block {
  return block(id, parent, { block_type: 'ayat', ayat_surah: surah, ayat_number: number })
}

function makeIndex(
  blocks: Block[],
  categories: Map<string, string[]> = new Map(),
): SearchIndex {
  return {
    blocks,
    byId: new Map(blocks.map((b) => [b.id, b])),
    categories: new Map(
      [...categories].map(([id, direct]) => [id, { direct, inherited: [] }]),
    ),
    tagsByBlock: new Map(),
    allTags: [],
    allCategories: [...new Set([...categories.values()].flat())],
    documentTitles: new Map([['doc', 'Doc']]),
    trees: new Map([['doc', buildTree(blocks)]]),
  }
}

const NO_LINKS: LinkGraph = { outgoing: new Map(), incoming: new Map() }

describe('relatedAyat — aturan (a) parent–anak langsung', () => {
  it('ayat sebagai ANAK dari blok tema dihitung', () => {
    const blocks = [block('tema', ROOT), ayatBlock('ayat', 'tema', 2, 153)]
    expect(relatedAyat(makeIndex(blocks), NO_LINKS, 'tema')).toEqual([
      { surah: 2, number: 153 },
    ])
  })

  it('ayat sebagai PARENT dari blok tema juga dihitung (arah mana pun)', () => {
    const blocks = [ayatBlock('ayat', ROOT, 2, 153), block('tema', 'ayat')]
    expect(relatedAyat(makeIndex(blocks), NO_LINKS, 'tema')).toEqual([
      { surah: 2, number: 153 },
    ])
  })

  it('CUCU tidak dihitung — ini inti aturannya', () => {
    const blocks = [
      block('tema', ROOT),
      block('antara', 'tema'),
      ayatBlock('ayat', 'antara', 2, 153),
    ]
    expect(relatedAyat(makeIndex(blocks), NO_LINKS, 'tema')).toEqual([])
  })

  it('ayat di akar tidak menyeret seluruh dokumen', () => {
    const blocks = [
      ayatBlock('ayat', ROOT, 2, 153),
      block('lain', ROOT),
      block('jauh', 'lain'),
    ]
    expect(relatedAyat(makeIndex(blocks), NO_LINKS, 'jauh')).toEqual([])
    expect(relatedAyat(makeIndex(blocks), NO_LINKS, 'lain')).toEqual([])
  })

  it('saudara tidak dihitung', () => {
    const blocks = [block('tema', ROOT), ayatBlock('ayat', ROOT, 2, 153)]
    expect(relatedAyat(makeIndex(blocks), NO_LINKS, 'tema')).toEqual([])
  })
})

describe('relatedAyat — aturan (b) wiki-link eksplisit', () => {
  const blocks = [block('tema', ROOT), ayatBlock('ayat', ROOT, 4, 59)]

  it('link keluar dari blok ke ayat', () => {
    const links: LinkGraph = {
      outgoing: new Map([['tema', ['ayat']]]),
      incoming: new Map([['ayat', ['tema']]]),
    }
    expect(relatedAyat(makeIndex(blocks), links, 'tema')).toEqual([{ surah: 4, number: 59 }])
  })

  it('link masuk dari ayat ke blok', () => {
    const links: LinkGraph = {
      outgoing: new Map([['ayat', ['tema']]]),
      incoming: new Map([['tema', ['ayat']]]),
    }
    expect(relatedAyat(makeIndex(blocks), links, 'tema')).toEqual([{ surah: 4, number: 59 }])
  })
})

describe('collectTargets', () => {
  const blocks = [
    block('tema', ROOT, { is_promoted: 1 }),
    ayatBlock('a1', 'tema', 2, 153),
    ayatBlock('a2', ROOT, 2, 153), // ayat yang SAMA di tempat lain
    block('biasa', ROOT), // tidak dipromosikan
  ]

  it('mode A hanya untuk blok dipromosikan yang punya ayat terkait', () => {
    const targets = collectTargets(makeIndex(blocks), NO_LINKS, {
      modes: ['A'],
      category: null,
      limit: 50,
    })
    expect(targets).toEqual([{ mode: 'A', target_type: 'block', target_id: 'tema' }])
  })

  it('satu ayat di banyak tempat tetap SATU kartu drill', () => {
    const targets = collectTargets(makeIndex(blocks), NO_LINKS, {
      modes: ['B'],
      category: null,
      limit: 50,
    })
    expect(targets).toEqual([{ mode: 'B', target_type: 'ayat', target_id: '2:153' }])
  })

  it('mode B & C dijadwalkan terpisah untuk ayat yang sama', () => {
    const targets = collectTargets(makeIndex(blocks), NO_LINKS, {
      modes: ['B', 'C'],
      category: null,
      limit: 50,
    })
    expect(targets.map((t) => t.mode).sort()).toEqual(['B', 'C'])
    expect(new Set(targets.map((t) => t.target_id))).toEqual(new Set(['2:153']))
  })

  it('filter kategori menyertakan turunan', () => {
    const categories = new Map([['tema', ['dakwah/manhaj']]])
    const index = makeIndex(blocks, categories)
    const hit = collectTargets(index, NO_LINKS, {
      modes: ['A'],
      category: 'dakwah',
      limit: 50,
    })
    expect(hit).toHaveLength(1)
    const miss = collectTargets(index, NO_LINKS, {
      modes: ['A'],
      category: 'aqidah',
      limit: 50,
    })
    expect(miss).toHaveLength(0)
  })

  it('blok tanpa ayat terkait tidak masuk mode A', () => {
    const lonely = [block('sendiri', ROOT, { is_promoted: 1 })]
    expect(
      collectTargets(makeIndex(lonely), NO_LINKS, { modes: ['A'], category: null, limit: 50 }),
    ).toEqual([])
  })
})
