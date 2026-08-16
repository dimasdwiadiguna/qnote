import { db } from '../db/db'
import type { Ayat, SurahMeta } from '../db/types'
import { arabicSearchKey, normalizeLatin, squash } from './normalize'

/**
 * Pencarian ayat untuk palet sisip (brief §5). Tiga bentuk query dikenali:
 *   1. rujukan     `2:153` · `2 153` · `2.153`
 *   2. nama surah  `al baqarah 153` · `albaqarah` · `baqarah`
 *   3. potongan    terjemah Indonesia atau teks Arab (tanpa harakat)
 */

export interface AyatHit {
  ayat: Ayat
  surah: SurahMeta | undefined
  /** Makin kecil makin relevan. */
  rank: number
}

const REFERENCE = /^(\d{1,3})\s*[:.\-\s]\s*(\d{1,3})$/
const SURAH_ONLY = /^(\d{1,3})$/

function rankFor(kind: 'ref' | 'surah' | 'name' | 'translation' | 'arabic'): number {
  switch (kind) {
    case 'ref':
      return 0
    case 'surah':
      return 1
    case 'name':
      return 2
    case 'translation':
      return 3
    case 'arabic':
      return 4
  }
}

export async function searchAyat(rawQuery: string, limit = 30): Promise<AyatHit[]> {
  const query = rawQuery.trim()
  if (query.length === 0) return []

  const surahs = await db.surahs.toArray()
  const surahById = new Map(surahs.map((s) => [s.surah, s]))
  const hits: AyatHit[] = []
  const seen = new Set<string>()

  const push = (ayat: Ayat, rank: number): void => {
    const key = `${ayat.surah}:${ayat.number}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ ayat, surah: surahById.get(ayat.surah), rank })
  }

  // ── 1. rujukan langsung ──
  const reference = REFERENCE.exec(query)
  if (reference) {
    const surah = Number(reference[1])
    const number = Number(reference[2])
    const found = await db.ayat.get([surah, number])
    if (found) push(found, rankFor('ref'))
  }

  // ── 2. nomor surah saja → tampilkan ayat-ayat awalnya ──
  const surahOnly = SURAH_ONLY.exec(query)
  if (surahOnly) {
    const surah = Number(surahOnly[1])
    if (surah >= 1 && surah <= 114) {
      const rows = await db.ayat.where('surah').equals(surah).limit(limit).toArray()
      for (const row of rows) push(row, rankFor('surah'))
    }
  }

  // ── 3. nama surah (+ nomor ayat opsional) ──
  const nameMatch = /^(.*?)[\s:.\-]*(\d{1,3})?$/.exec(query)
  const namePart = (nameMatch?.[1] ?? '').trim()
  const numberPart = nameMatch?.[2] ? Number(nameMatch[2]) : null
  const nameKey = squash(namePart)
  if (nameKey.length >= 3) {
    const matched = surahs
      .filter((s) => s.name_squashed.includes(nameKey) || squash(s.name_id).includes(nameKey))
      .slice(0, 4)
    for (const surah of matched) {
      if (numberPart !== null) {
        const found = await db.ayat.get([surah.surah, numberPart])
        if (found) push(found, rankFor('name'))
      } else {
        const rows = await db.ayat.where('surah').equals(surah.surah).limit(8).toArray()
        for (const row of rows) push(row, rankFor('name'))
      }
    }
  }

  // ── 4. potongan terjemah / teks Arab ──
  if (hits.length < limit && query.length >= 3) {
    const latinNeedle = normalizeLatin(query)
    const arabicNeedle = arabicSearchKey(query)
    const useArabic = arabicNeedle.length >= 3 && arabicNeedle !== latinNeedle

    await db.ayat.each((row) => {
      if (hits.length >= limit) return
      if (latinNeedle.length >= 3 && row.translation_norm.includes(latinNeedle)) {
        push(row, rankFor('translation'))
        return
      }
      if (useArabic && row.arabic_norm.includes(arabicNeedle)) {
        push(row, rankFor('arabic'))
      }
    })
  }

  hits.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.ayat.surah !== b.ayat.surah) return a.ayat.surah - b.ayat.surah
    return a.ayat.number - b.ayat.number
  })
  return hits.slice(0, limit)
}

export function formatReference(surah: number, number: number): string {
  return `QS ${surah}:${number}`
}

export function formatSurahLabel(meta: SurahMeta | undefined, number: number): string {
  if (!meta) return `${number}`
  return `${meta.name_latin} : ${number}`
}
