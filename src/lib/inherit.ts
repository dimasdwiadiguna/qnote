import type { FlatNode } from './tree'
import { categoryAncestry } from './parser'

/**
 * Pewarisan kategori — DIHITUNG SAAT BACA, tidak pernah disimpan (brief §2.5).
 *
 * Alasannya bukan kemalasan: memindahkan bullet ke parent lain harus langsung
 * benar tanpa backfill. Kalau warisan dimaterialisasi, satu drag pada bullet
 * berisi 200 keturunan berarti 200 baris berubah dan 200 potensi konflik sync.
 *
 * Aturan berlaku SERAGAM untuk semua `block_type` — blok ayat mewariskan
 * kategorinya persis seperti blok teks, dan menerima warisan dari leluhurnya.
 */

export interface CategoryAssignment {
  /** Kategori yang ditulis langsung di `content` blok ini. */
  direct: string[]
  /** Kategori yang datang dari leluhur (ditampilkan redup). */
  inherited: string[]
}

const EMPTY: CategoryAssignment = { direct: [], inherited: [] }

/**
 * Satu pass menurun pada subtree yang sedang tampil: O(n) node, bukan
 * O(n × kedalaman). `nodes` harus hasil `flattenTree` (pre-order + depth).
 */
export function computeInheritance(
  nodes: readonly FlatNode[],
  directByBlock: ReadonlyMap<string, string[]>,
  seedFromAncestors: readonly string[] = [],
): Map<string, CategoryAssignment> {
  const result = new Map<string, CategoryAssignment>()
  /** stack[d] = himpunan kategori efektif pada kedalaman d. */
  const stack: Set<string>[] = []
  const seed = new Set(seedFromAncestors)

  for (const node of nodes) {
    const inheritedSet = node.depth === 0 ? seed : (stack[node.depth - 1] ?? new Set<string>())
    const direct = directByBlock.get(node.block.id) ?? []

    const inherited: string[] = []
    for (const path of inheritedSet) {
      if (!direct.includes(path)) inherited.push(path)
    }
    inherited.sort()

    result.set(node.block.id, direct.length || inherited.length ? { direct, inherited } : EMPTY)

    const effective = new Set(inheritedSet)
    for (const path of direct) effective.add(path)
    stack[node.depth] = effective
    stack.length = node.depth + 1
  }

  return result
}

/**
 * Kategori efektif sebuah blok, diperluas ke seluruh leluhur path-nya.
 * `[dakwah/manhaj]` juga cocok untuk filter `[dakwah]` (brief §2.5).
 */
export function expandForFilter(paths: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const path of paths) {
    for (const ancestor of categoryAncestry(path)) out.add(ancestor)
  }
  return out
}

/** Apakah `path` sama dengan atau turunan dari `filter`. */
export function matchesCategoryFilter(path: string, filter: string): boolean {
  return path === filter || path.startsWith(`${filter}/`)
}
