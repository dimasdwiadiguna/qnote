import { db, getMeta, META, setMeta } from './db'
import { arabicSearchKey, normalizeLatin, squash } from '../lib/normalize'
import type { Ayat, SurahMeta } from './types'

/**
 * Impor data Quran ke Dexie — sekali saat boot pertama.
 *
 * Tiga sifat yang wajib dipegang (brief §5, risiko R11):
 *  - BERTAHAP: satu surah = satu transaksi, dengan yield ke event loop di
 *    antaranya. `JSON.parse` satu file 8 MB akan membekukan main thread HP.
 *  - IDEMPOTEN: primary key `[surah+number]` + `bulkPut`. Gagal di tengah boleh
 *    diulang tanpa duplikasi.
 *  - NON-BLOCKING: dijalankan setelah first paint. Menulis catatan teks harus
 *    bisa dilakukan sebelum impor selesai.
 */

const TOTAL_SURAHS = 114

export interface SeedProgress {
  done: boolean
  surahsLoaded: number
  totalSurahs: number
  ayatCount: number
  error: string | null
}

interface RawSurahFile {
  surah: number
  name_arabic: string
  name_latin: string
  name_id: string
  ayah_count: number
  ayat: { number: number; arabic: string; translation_id: string }[]
}

function surahPath(surah: number): string {
  return `/data/quran/${String(surah).padStart(3, '0')}.json`
}

/** Menyerahkan main thread sebentar supaya UI tidak terasa membeku. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function isSeeded(): Promise<boolean> {
  return getMeta<boolean>(META.seedDone, false)
}

export async function seedStatus(): Promise<SeedProgress> {
  const done = await getMeta<boolean>(META.seedDone, false)
  const surahsLoaded = await getMeta<number>(META.seedProgress, 0)
  const ayatCount = await db.ayat.count()
  return { done, surahsLoaded, totalSurahs: TOTAL_SURAHS, ayatCount, error: null }
}

async function importSurah(surah: number): Promise<void> {
  const response = await fetch(surahPath(surah))
  if (!response.ok) throw new Error(`Gagal memuat surah ${surah} (HTTP ${response.status})`)
  const file = (await response.json()) as RawSurahFile

  const rows: Ayat[] = file.ayat.map((entry) => ({
    surah: file.surah,
    number: entry.number,
    arabic: entry.arabic,
    translation_id: entry.translation_id,
    arabic_norm: arabicSearchKey(entry.arabic),
    translation_norm: normalizeLatin(entry.translation_id),
  }))

  const meta: SurahMeta = {
    surah: file.surah,
    name_arabic: file.name_arabic,
    name_latin: file.name_latin,
    name_id: file.name_id,
    ayah_count: file.ayah_count,
    name_squashed: squash(file.name_latin),
  }

  await db.transaction('rw', db.ayat, db.surahs, db.meta, async () => {
    await db.ayat.bulkPut(rows)
    await db.surahs.put(meta)
    await db.meta.put({ key: META.seedProgress, value: surah })
  })
}

/**
 * Menjalankan impor, melanjutkan dari surah terakhir yang sukses.
 * Aman dipanggil berkali-kali.
 */
export async function runSeed(
  onProgress?: (progress: SeedProgress) => void,
): Promise<SeedProgress> {
  const alreadyDone = await getMeta<boolean>(META.seedDone, false)
  if (alreadyDone) return seedStatus()

  let from = (await getMeta<number>(META.seedProgress, 0)) + 1

  // Kalau meta hilang tapi data ada (mis. setelah pemulihan), jangan ulangi
  // dari nol — cari surah pertama yang benar-benar kosong.
  if (from === 1 && (await db.ayat.count()) > 0) {
    for (let surah = 1; surah <= TOTAL_SURAHS; surah += 1) {
      const count = await db.ayat.where('surah').equals(surah).count()
      if (count === 0) {
        from = surah
        break
      }
      from = surah + 1
    }
  }

  for (let surah = from; surah <= TOTAL_SURAHS; surah += 1) {
    try {
      await importSurah(surah)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed: SeedProgress = {
        done: false,
        surahsLoaded: surah - 1,
        totalSurahs: TOTAL_SURAHS,
        ayatCount: await db.ayat.count(),
        error: message,
      }
      onProgress?.(failed)
      return failed
    }
    if (onProgress && (surah % 4 === 0 || surah === TOTAL_SURAHS)) {
      onProgress({
        done: false,
        surahsLoaded: surah,
        totalSurahs: TOTAL_SURAHS,
        ayatCount: 0,
        error: null,
      })
    }
    await yieldToUi()
  }

  await setMeta(META.seedDone, true)
  const final = await seedStatus()
  onProgress?.(final)
  return final
}

/** Membuang data ayat & menandai perlu impor ulang (dipakai di Setelan). */
export async function resetSeed(): Promise<void> {
  await db.transaction('rw', db.ayat, db.surahs, db.meta, async () => {
    await db.ayat.clear()
    await db.surahs.clear()
    await db.meta.put({ key: META.seedProgress, value: 0 })
    await db.meta.put({ key: META.seedDone, value: false })
  })
}
