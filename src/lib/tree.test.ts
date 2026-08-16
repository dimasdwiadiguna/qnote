import { describe, expect, it } from 'vitest'
import { ROOT, type Block } from '../db/types'
import { ancestorsOf, buildTree, descendantIds, flattenTree, immediateNeighbours } from './tree'
import { computeInheritance } from './inherit'

let counter = 0

function block(id: string, parent: string, order: string, patch: Partial<Block> = {}): Block {
  counter += 1
  const now = new Date(2026, 0, 1, 0, 0, counter).toISOString()
  return {
    id,
    document_id: 'doc',
    parent_id: parent,
    order_key: order,
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

/**
 *  a           [dakwah]
 *  ├── b       [ushul]
 *  │   └── c
 *  └── d  (ayat)
 *  e
 */
const blocks: Block[] = [
  block('a', ROOT, 'a0'),
  block('b', 'a', 'a0'),
  block('c', 'b', 'a0'),
  block('d', 'a', 'a1', { block_type: 'ayat', ayat_surah: 2, ayat_number: 153 }),
  block('e', ROOT, 'a1'),
]

describe('buildTree & flattenTree', () => {
  it('urutan pre-order mengikuti order_key', () => {
    const tree = buildTree(blocks)
    expect(flattenTree(tree).map((n) => n.block.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('kedalaman benar', () => {
    const tree = buildTree(blocks)
    const depths = Object.fromEntries(flattenTree(tree).map((n) => [n.block.id, n.depth]))
    expect(depths).toEqual({ a: 0, b: 1, c: 2, d: 1, e: 0 })
  })

  it('collapse menyembunyikan keturunan dan melaporkan jumlahnya', () => {
    const collapsed = blocks.map((b) => (b.id === 'a' ? { ...b, is_collapsed: 1 as const } : b))
    const nodes = flattenTree(buildTree(collapsed))
    expect(nodes.map((n) => n.block.id)).toEqual(['a', 'e'])
    expect(nodes[0]?.hiddenCount).toBe(3)
  })

  it('blok terhapus tidak pernah muncul', () => {
    const withDeleted = blocks.map((b) =>
      b.id === 'b' ? { ...b, deleted_at: '2026-01-01T00:00:00Z' } : b,
    )
    expect(flattenTree(buildTree(withDeleted)).map((n) => n.block.id)).toEqual(['a', 'd', 'e'])
  })

  it('zoom-in memakai blok sebagai akar dan tidak menyertakan dirinya', () => {
    const nodes = flattenTree(buildTree(blocks), 'a')
    expect(nodes.map((n) => n.block.id)).toEqual(['b', 'c', 'd'])
    expect(nodes[0]?.depth).toBe(0)
  })

  it('breadcrumb naik sampai akar', () => {
    expect(ancestorsOf(buildTree(blocks), 'c').map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('keturunan', () => {
    expect(descendantIds(buildTree(blocks), 'a').sort()).toEqual(['b', 'c', 'd'])
  })
})

describe('immediateNeighbours — dasar aturan keterkaitan Mode A', () => {
  it('hanya satu tingkat: parent langsung + anak langsung', () => {
    const tree = buildTree(blocks)
    expect(immediateNeighbours(tree, 'b').map((b) => b.id).sort()).toEqual(['a', 'c'])
  })

  it('cucu TIDAK dihitung sebagai tetangga', () => {
    const tree = buildTree(blocks)
    expect(immediateNeighbours(tree, 'a').map((b) => b.id)).not.toContain('c')
  })

  it('blok akar tidak punya parent', () => {
    const tree = buildTree(blocks)
    expect(immediateNeighbours(tree, 'e')).toEqual([])
  })
})

describe('pewarisan kategori — computed saat baca', () => {
  const direct = new Map<string, string[]>([
    ['a', ['dakwah']],
    ['b', ['ushul']],
  ])

  it('keturunan mewarisi kategori leluhur', () => {
    const nodes = flattenTree(buildTree(blocks))
    const result = computeInheritance(nodes, direct)
    expect(result.get('b')).toEqual({ direct: ['ushul'], inherited: ['dakwah'] })
    expect(result.get('c')).toEqual({ direct: [], inherited: ['dakwah', 'ushul'] })
  })

  it('blok ayat mewarisi persis seperti blok teks (brief §2.5)', () => {
    const nodes = flattenTree(buildTree(blocks))
    const result = computeInheritance(nodes, direct)
    expect(result.get('d')).toEqual({ direct: [], inherited: ['dakwah'] })
  })

  it('blok ayat juga MEWARISKAN kategorinya ke anaknya', () => {
    const withChild = [...blocks, block('f', 'd', 'a0')]
    const nodes = flattenTree(buildTree(withChild))
    const result = computeInheritance(nodes, new Map([['d', ['shalat']]]))
    expect(result.get('f')).toEqual({ direct: [], inherited: ['shalat'] })
  })

  it('saudara tidak saling mewarisi', () => {
    const nodes = flattenTree(buildTree(blocks))
    const result = computeInheritance(nodes, direct)
    expect(result.get('e')).toEqual({ direct: [], inherited: [] })
  })

  it('kategori langsung tidak diduplikasi sebagai warisan', () => {
    const nodes = flattenTree(buildTree(blocks))
    const result = computeInheritance(nodes, new Map([['a', ['dakwah']], ['b', ['dakwah']]]))
    expect(result.get('b')).toEqual({ direct: ['dakwah'], inherited: [] })
  })

  it('memindah bullet ke parent lain langsung benar tanpa backfill', () => {
    // c dipindah dari b ke e — warisan harus ikut berubah seketika.
    const moved = blocks.map((b) => (b.id === 'c' ? { ...b, parent_id: 'e' } : b))
    const nodes = flattenTree(buildTree(moved))
    const result = computeInheritance(nodes, direct)
    expect(result.get('c')).toEqual({ direct: [], inherited: [] })
  })

  it('zoom-in tetap mewarisi kategori dari leluhur di atas akar tampilan', () => {
    const nodes = flattenTree(buildTree(blocks), 'b')
    const result = computeInheritance(nodes, direct, ['dakwah', 'ushul'])
    expect(result.get('c')).toEqual({ direct: [], inherited: ['dakwah', 'ushul'] })
  })
})
