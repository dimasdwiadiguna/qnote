import { AYAT_KEY, parseAyatKey } from '../db/types'

/**
 * Memilih ayat di layar pembaca.
 *
 * Murni, tanpa I/O, supaya aturan pemilihan bisa diuji tanpa DOM — bagian ini
 * gampang salah di ujung-ujungnya (rentang mundur, rentang lintas surah,
 * urutan hasil).
 *
 * Kunci pemilihan memakai bentuk yang sama dengan identitas kartu drill:
 * `"2:153"` lewat `AYAT_KEY` / `parseAyatKey`.
 */

export interface AyatRef {
  surah: number
  number: number
}

/** Ketuk baris = pilih / batal pilih. Gestur yang sama untuk kedua arah. */
export function toggleAyat(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/**
 * Tahan baris = pilih rentang dari `anchor` sampai `to`.
 *
 * Arah tidak dibatasi: menahan ayat DI ATAS jangkar memilih ke atas, persis
 * seperti ke bawah. Rentang lintas surah tidak dibentuk — pembaca menampilkan
 * satu surah, dan "153 sampai 3:8" tidak punya arti yang jelas; dalam kasus itu
 * hanya `to` yang ditambahkan.
 */
export function extendRange(
  selected: ReadonlySet<string>,
  anchor: string,
  to: string,
): Set<string> {
  const from = parseAyatKey(anchor)
  const target = parseAyatKey(to)
  const next = new Set(selected)

  if (!target) return next
  if (!from || from.surah !== target.surah) {
    next.add(to)
    return next
  }

  const start = Math.min(from.number, target.number)
  const end = Math.max(from.number, target.number)
  for (let number = start; number <= end; number += 1) {
    next.add(AYAT_KEY(target.surah, number))
  }
  return next
}

/** Selalu urut naik (surah, lalu nomor) — urutan blok yang dibuat ikut ini. */
export function selectionToRefs(selected: ReadonlySet<string>): AyatRef[] {
  const refs: AyatRef[] = []
  for (const key of selected) {
    const ref = parseAyatKey(key)
    if (ref) refs.push(ref)
  }
  refs.sort((a, b) => (a.surah !== b.surah ? a.surah - b.surah : a.number - b.number))
  return refs
}

/**
 * Label ringkas untuk sheet anotasi: `QS 2:153–155`, dan
 * `QS 2:153–155, 160` bila ada lompatan. Deretan berurutan dirapatkan supaya
 * memilih sepuluh ayat tidak menghasilkan sepuluh rujukan berjejer.
 */
export function formatSelection(refs: readonly AyatRef[]): string {
  if (refs.length === 0) return ''

  const parts: string[] = []
  let index = 0
  while (index < refs.length) {
    const first = refs[index] as AyatRef
    let last = first
    let step = index + 1
    while (step < refs.length) {
      const candidate = refs[step] as AyatRef
      if (candidate.surah !== last.surah || candidate.number !== last.number + 1) break
      last = candidate
      step += 1
    }

    const previous = parts.length > 0 ? refs[index - 1] : undefined
    const sameSurah = previous !== undefined && previous.surah === first.surah
    const head = sameSurah ? `${first.number}` : `${first.surah}:${first.number}`
    parts.push(last.number === first.number ? head : `${head}–${last.number}`)
    index = step
  }

  return `QS ${parts.join(', ')}`
}
