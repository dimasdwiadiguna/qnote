/**
 * Normalisasi teks untuk pencarian.
 *
 * Dua jalur berbeda dan sengaja dipisah:
 *  - Latin: case-folding + buang aksen.
 *  - Arab: buang harakat/tanda Quranik, satukan varian alif/ya/ta-marbuta.
 *
 * Hasilnya disimpan di kolom `search_norm` saat tulis, supaya pencarian tidak
 * menormalisasi ulang 6236 ayat pada tiap ketikan.
 *
 * Semua karakter Arab ditulis sebagai escape \u — tanda gabung (combining marks)
 * yang ditulis literal bisa berpindah posisi saat file disimpan/dinormalisasi.
 */

/**
 * Harakat, tanda Quranik, tatweel, superscript alif.
 *   ؐ-ؚ honorific · ً-ٟ harakat · ٰ superscript alif
 *   ۖ-ۭ waqaf & sajdah · ـ tatweel · ࣓-ࣿ tanda tambahan
 */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]/g

/** Ornamen & pemisah yang tidak pernah relevan untuk pencarian. */
const ARABIC_ORNAMENTS = /[،؍؏؛؞؟٪-٭۝۞۩]/g

export function normalizeArabic(input: string): string {
  return input
    .normalize('NFC')
    .replace(ARABIC_MARKS, '')
    .replace(ARABIC_ORNAMENTS, '')
    .replace(/[آأإٱٲٳ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeLatin(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // Apostrof lurus & keriting, ditulis sebagai escape supaya tidak ikut
    // "dirapikan" oleh editor menjadi karakter yang sama.
    .replace(/['‘’ʼ`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Kunci pencarian Arab — lebih agresif dari `normalizeArabic`.
 *
 * Masalahnya nyata: mushaf Kemenag memakai alif khanjariyah (superscript alif,
 * U+0670) di tempat ejaan modern memakai alif penuh. `الصّٰبِرِيْنَ` diketik orang
 * sebagai `الصابرين`, dan `اللّٰه` diketik sebagai `الله`.
 *
 *   · hapus alif superscript → `الصبرين` tapi query `الصابرين` tetap meleset
 *   · ubah jadi alif penuh   → `الصابرين` cocok, tapi `اللاه` vs `الله` meleset
 *
 * Tidak ada arah tunggal yang benar. Jadi kedua sisi diratakan: SEMUA alif
 * dibuang dari teks maupun query. `الصابرين` dan `الصّٰبِرِيْنَ` sama-sama jadi
 * `لصبرين`, `الله` dan `اللّٰه` sama-sama jadi `لله`. Presisi berkurang sedikit,
 * tetapi pencarian jadi benar-benar bekerja untuk ejaan mana pun.
 *
 * Hanya dipakai untuk indeks & query — teks yang DITAMPILKAN selalu asli.
 */
export function arabicSearchKey(input: string): string {
  return normalizeArabic(input).replace(/ا/g, '')
}

const HAS_ARABIC = /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-﻿]/

/**
 * Normalisasi campuran: satu bullet bisa berisi Latin dan Arab sekaligus.
 * Kedua aturan diterapkan; rentang karakternya terpisah sehingga tidak saling
 * merusak.
 */
export function normalizeSearch(input: string): string {
  const arabicApplied = HAS_ARABIC.test(input) ? arabicSearchKey(input) : input
  return normalizeLatin(arabicApplied)
}

/** Nama tag & kategori selalu disimpan lowercase & rapat. */
export function normalizeName(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Membandingkan nama surah: "Al-Baqarah" ≡ "al baqarah" ≡ "albaqarah". */
export function squash(input: string): string {
  return normalizeLatin(input).replace(/[^a-z0-9]/g, '')
}
