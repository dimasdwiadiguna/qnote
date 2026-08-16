import { compareOrder } from '../db/ordering'
import { ROOT, type Block } from '../db/types'

/** Satu baris siap render: blok + kedalaman + apakah punya anak. */
export interface FlatNode {
  block: Block
  depth: number
  hasChildren: boolean
  /** Jumlah keturunan yang tersembunyi karena blok ini ter-collapse. */
  hiddenCount: number
}

export interface Tree {
  byParent: Map<string, Block[]>
  byId: Map<string, Block>
}

export function buildTree(blocks: readonly Block[]): Tree {
  const byParent = new Map<string, Block[]>()
  const byId = new Map<string, Block>()
  for (const block of blocks) {
    if (block.deleted_at) continue
    byId.set(block.id, block)
    const siblings = byParent.get(block.parent_id)
    if (siblings) siblings.push(block)
    else byParent.set(block.parent_id, [block])
  }
  for (const siblings of byParent.values()) siblings.sort(compareOrder)
  return { byParent, byId }
}

function countSubtree(tree: Tree, id: string): number {
  let total = 0
  const stack = [...(tree.byParent.get(id) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop() as Block
    total += 1
    for (const child of tree.byParent.get(node.id) ?? []) stack.push(child)
  }
  return total
}

/**
 * Meratakan pohon jadi daftar urut tampilan (pre-order), menghormati
 * `is_collapsed`. Ini input untuk virtualisasi list.
 *
 * `rootId` = ROOT untuk seluruh dokumen, atau id blok saat sedang zoom-in.
 * Blok akar zoom sendiri TIDAK ikut dalam hasil — ia digambar sebagai judul.
 */
export function flattenTree(tree: Tree, rootId: string = ROOT): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (parentId: string, depth: number): void => {
    for (const block of tree.byParent.get(parentId) ?? []) {
      const children = tree.byParent.get(block.id) ?? []
      const collapsed = block.is_collapsed === 1 && children.length > 0
      out.push({
        block,
        depth,
        hasChildren: children.length > 0,
        hiddenCount: collapsed ? countSubtree(tree, block.id) : 0,
      })
      if (!collapsed) walk(block.id, depth + 1)
    }
  }
  walk(rootId, 0)
  return out
}

/** Rantai leluhur untuk breadcrumb, dari akar ke blok (blok itu sendiri ikut). */
export function ancestorsOf(tree: Tree, blockId: string): Block[] {
  const chain: Block[] = []
  const seen = new Set<string>()
  let current = tree.byId.get(blockId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    if (current.parent_id === ROOT) break
    current = tree.byId.get(current.parent_id)
  }
  return chain
}

/** Semua keturunan sebuah blok (tidak termasuk blok itu sendiri). */
export function descendantIds(tree: Tree, rootId: string): string[] {
  const out: string[] = []
  const stack = [...(tree.byParent.get(rootId) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop() as Block
    out.push(node.id)
    for (const child of tree.byParent.get(node.id) ?? []) stack.push(child)
  }
  return out
}

/**
 * Tetangga satu tingkat: parent langsung + anak langsung.
 * Dipakai untuk aturan keterkaitan Mode A drill (brief §7): kekerabatan lebih
 * jauh dari satu tingkat TIDAK dihitung, karena ayat di akar dokumen akan
 * menyeret seluruh isi dokumen jadi "terkait".
 */
export function immediateNeighbours(tree: Tree, blockId: string): Block[] {
  const out: Block[] = []
  const self = tree.byId.get(blockId)
  if (!self) return out
  if (self.parent_id !== ROOT) {
    const parent = tree.byId.get(self.parent_id)
    if (parent) out.push(parent)
  }
  out.push(...(tree.byParent.get(blockId) ?? []))
  return out
}
