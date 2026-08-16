import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * Fractional index untuk `blocks.order_key`.
 *
 * Bukan integer berurutan: memindahkan satu bullet tidak boleh menulis ulang
 * seluruh saudaranya — itu merusak sync per blok (satu drag = ratusan baris
 * konflik). Dengan fractional index, satu sisipan = satu baris berubah.
 */

export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  return generateNKeysBetween(a, b, count)
}

/**
 * Urutan tampilan. Tie-break pada `id` menjaga urutan tetap deterministik bila
 * dua device menghasilkan `order_key` identik saat offline (risiko R12).
 */
export function compareOrder(
  a: { order_key: string; id: string },
  b: { order_key: string; id: string },
): number {
  if (a.order_key < b.order_key) return -1
  if (a.order_key > b.order_key) return 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByOrder<T extends { order_key: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort(compareOrder)
}
