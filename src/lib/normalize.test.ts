import { describe, expect, it } from 'vitest'
import {
  arabicSearchKey,
  normalizeArabic,
  normalizeLatin,
  normalizeName,
  normalizeSearch,
  squash,
} from './normalize'

describe('normalizeArabic — harakat diabaikan', () => {
  it('membuang harakat sehingga pencarian tanpa harakat tetap cocok', () => {
    const withMarks = 'الْحَمْدُ لِلّٰهِ رَبِّ الْعٰلَمِيْنَ'
    const plain = normalizeArabic(withMarks)
    expect(plain).not.toContain('َ') // fatha
    expect(plain).not.toContain('ْ') // sukun
    expect(plain.includes('الحمد')).toBe(true)
  })

  it('varian alif disatukan', () => {
    expect(normalizeArabic('أإآا')).toBe('اااا')
  })

  it('ta marbuta → ha, alif maqsura → ya', () => {
    expect(normalizeArabic('صلاة')).toBe('صلاه')
    expect(normalizeArabic('على')).toBe('علي')
  })

  it('tatweel dibuang', () => {
    expect(normalizeArabic('الرحـــمن')).toBe('الرحمن')
  })

  it('mencari tanpa harakat menemukan teks berharakat', () => {
    const ayat = normalizeArabic('اِنَّ اللّٰهَ مَعَ الصّٰبِرِيْنَ')
    expect(ayat.includes(normalizeArabic('مع'))).toBe(true)
  })
})

describe('arabicSearchKey — alif khanjariyah vs ejaan modern', () => {
  const ayat = arabicSearchKey('اِنَّ اللّٰهَ مَعَ الصّٰبِرِيْنَ')

  it('ejaan modern dengan alif penuh menemukan teks mushaf', () => {
    expect(ayat.includes(arabicSearchKey('الصابرين'))).toBe(true)
  })

  it('ejaan mushaf tanpa alif penuh juga menemukan', () => {
    expect(ayat.includes(arabicSearchKey('الصبرين'))).toBe(true)
  })

  it('lafaz Allah cocok dari kedua ejaan', () => {
    expect(ayat.includes(arabicSearchKey('الله'))).toBe(true)
    expect(ayat.includes(arabicSearchKey('اللّٰه'))).toBe(true)
  })

  it('kata yang berbeda tetap tidak cocok', () => {
    expect(ayat.includes(arabicSearchKey('الرحمن'))).toBe(false)
  })
})

describe('normalizeLatin', () => {
  it('case- dan aksen-insensitif', () => {
    expect(normalizeLatin('Tadabbur')).toBe('tadabbur')
    expect(normalizeLatin('Qur’ān')).toBe('quran')
    expect(normalizeLatin('Sholât')).toBe('sholat')
  })

  it('spasi berlebih dirapikan', () => {
    expect(normalizeLatin('  dua   spasi ')).toBe('dua spasi')
  })
})

describe('normalizeSearch — campuran', () => {
  it('menangani Latin dan Arab dalam satu string', () => {
    const result = normalizeSearch('Sabar الصَّبْر')
    expect(result).toContain('sabar')
    // Bagian Arab diratakan jadi kunci pencarian (alif dibuang, lihat
    // arabicSearchKey) — query Arab dinormalisasi dengan aturan yang sama.
    expect(result).toContain(normalizeSearch('الصبر'))
    expect(result).toContain(normalizeSearch('الصابر'))
  })
})

describe('normalizeName & squash', () => {
  it('nama tag/kategori jadi lowercase rapat', () => {
    expect(normalizeName('  Dakwah  Manhaj ')).toBe('dakwah manhaj')
  })

  it('squash menyamakan varian penulisan nama surah', () => {
    expect(squash('Al-Baqarah')).toBe('albaqarah')
    expect(squash('al baqarah')).toBe('albaqarah')
    expect(squash('AlBaqarah')).toBe('albaqarah')
  })
})
