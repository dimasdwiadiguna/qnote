import { describe, expect, it } from 'vitest'
import {
  categoryAncestry,
  parseCategoryPath,
  parseContent,
  segmentContent,
  stripMarkup,
} from './parser'

describe('tabrakan sintaks [[ ]] vs [ ] — brief §2.6', () => {
  it('kasus uji wajib dari brief', () => {
    const result = parseContent('lihat [[Blok A]] dalam [dakwah/manhaj] dan [ushul]')
    expect(result.links).toEqual(['blok a'])
    expect(result.categories).toEqual(['dakwah/manhaj', 'ushul'])
    expect(result.tags).toEqual([])
  })

  it('wiki-link duluan meski kategori muncul lebih awal di teks', () => {
    const result = parseContent('[aqidah] lalu [[Blok B]] lalu [fiqih]')
    expect(result.categories).toEqual(['aqidah', 'fiqih'])
    expect(result.links).toEqual(['blok b'])
  })

  it('dua wiki-link berdampingan', () => {
    expect(parseContent('[[A]][[B]]').links).toEqual(['a', 'b'])
  })

  it('kategori langsung setelah wiki-link tanpa spasi', () => {
    const result = parseContent('[[Blok A]][ushul]')
    expect(result.links).toEqual(['blok a'])
    expect(result.categories).toEqual(['ushul'])
  })

  it('`[[` menggantung tidak menelan sisa baris', () => {
    const result = parseContent('rusak [[ tapi [ushul] tetap terbaca')
    expect(result.links).toEqual([])
    expect(result.categories).toEqual(['ushul'])
  })

  it('`]]` menggantung tanpa pembuka', () => {
    const result = parseContent('teks ]] lalu [dakwah]')
    expect(result.categories).toEqual(['dakwah'])
    expect(result.links).toEqual([])
  })

  it('kurung siku bersarang ditolak sebagai link', () => {
    const result = parseContent('[[a[b]]')
    expect(result.links).toEqual([])
  })

  it('offset token menunjuk posisi yang benar', () => {
    const text = 'lihat [[Blok A]] dalam [ushul]'
    const { tokens } = parseContent(text)
    expect(tokens).toHaveLength(2)
    const [link, category] = tokens
    expect(text.slice(link!.start, link!.end)).toBe('[[Blok A]]')
    expect(text.slice(category!.start, category!.end)).toBe('[ushul]')
  })
})

describe('kategori', () => {
  it('berjenjang tiga level', () => {
    expect(parseContent('[dakwah/manhaj/tarbiyah]').categories).toEqual([
      'dakwah/manhaj/tarbiyah',
    ])
  })

  it('dinormalisasi lowercase dan spasi dirapikan', () => {
    expect(parseContent('[ Dakwah / Manhaj ]').categories).toEqual(['dakwah/manhaj'])
  })

  it('duplikat dibuang, urutan kemunculan dipertahankan', () => {
    expect(parseContent('[b] [a] [B]').categories).toEqual(['b', 'a'])
  })

  it('prosa berkurung siku panjang TIDAK jadi kategori (PLAN §9.1)', () => {
    expect(parseContent('kutipan [lihat catatan buku halaman 40!] selesai').categories).toEqual(
      [],
    )
  })

  it('kurung siku pendek yang cocok pola tetap jadi kategori', () => {
    expect(parseContent('kata [sic] di sini').categories).toEqual(['sic'])
  })

  it('kurung siku kosong diabaikan', () => {
    expect(parseContent('[] [ ]').categories).toEqual([])
  })

  it('segmen kosong menolak seluruh path', () => {
    expect(parseCategoryPath('dakwah//manhaj')).toBeNull()
    expect(parseCategoryPath('/dakwah')).toBeNull()
    expect(parseCategoryPath('dakwah/')).toBeNull()
  })

  it('leluhur path', () => {
    expect(categoryAncestry('a/b/c')).toEqual(['a', 'a/b', 'a/b/c'])
    expect(categoryAncestry('a')).toEqual(['a'])
  })
})

describe('tag', () => {
  it('tag sederhana', () => {
    expect(parseContent('Islam adalah sebuah #sistem hidup').tags).toEqual(['sistem'])
  })

  it('tag di akhir baris', () => {
    expect(parseContent('penutup #dakwah').tags).toEqual(['dakwah'])
  })

  it('tanda baca setelah tag tidak ikut', () => {
    expect(parseContent('itu #sistem, bukan #ide.').tags).toEqual(['sistem', 'ide'])
  })

  it('tag multi-kata pakai hyphen/underscore (PLAN §9.3)', () => {
    expect(parseContent('#fiqih-muamalah dan #ushul_fiqih').tags).toEqual([
      'fiqih-muamalah',
      'ushul_fiqih',
    ])
  })

  it('`#` di tengah kata bukan tag', () => {
    expect(parseContent('warna c#mayor bukan tag').tags).toEqual([])
  })

  it('`#` sendirian bukan tag', () => {
    expect(parseContent('cuma # saja').tags).toEqual([])
  })

  it('tag tidak menelan slash (tag itu datar)', () => {
    expect(parseContent('#dakwah/manhaj').tags).toEqual(['dakwah'])
  })

  it('tag huruf non-ASCII', () => {
    expect(parseContent('#taqwā').tags).toEqual(['taqwā'])
  })
})

describe('campuran & bidi', () => {
  it('teks Arab + tag tidak merusak offset', () => {
    const text = 'ayat الحمد لله #syukur [aqidah]'
    const result = parseContent(text)
    expect(result.tags).toEqual(['syukur'])
    expect(result.categories).toEqual(['aqidah'])
    const tagToken = result.tokens.find((t) => t.kind === 'tag')!
    expect(text.slice(tagToken.start, tagToken.end)).toBe('#syukur')
  })

  it('semua jenis penanda dalam satu bullet', () => {
    const result = parseContent(
      'Islam adalah #sistem yang menopang [[Blok A]] [dakwah/manhaj] [ushul] #hidup',
    )
    expect(result.tags).toEqual(['sistem', 'hidup'])
    expect(result.categories).toEqual(['dakwah/manhaj', 'ushul'])
    expect(result.links).toEqual(['blok a'])
  })
})

describe('stripMarkup', () => {
  it('membuang tag & kategori, mempertahankan teks link', () => {
    expect(
      stripMarkup('Islam adalah #sistem panduan [[Blok A]] hidup [dakwah/manhaj]'),
    ).toBe('Islam adalah panduan Blok A hidup')
  })

  it('teks tanpa penanda dikembalikan apa adanya', () => {
    expect(stripMarkup('  teks biasa  ')).toBe('teks biasa')
  })
})

describe('segmentContent', () => {
  it('memecah jadi teks dan chip berurutan tanpa kehilangan karakter', () => {
    const text = 'a [[L]] b [kat] c #t d'
    const segments = segmentContent(text)
    const rebuilt = segments
      .map((s) => (s.type === 'text' ? s.text : text.slice(s.token.start, s.token.end)))
      .join('')
    expect(rebuilt).toBe(text)
    expect(segments.filter((s) => s.type === 'token')).toHaveLength(3)
  })

  it('konten kosong menghasilkan nol segmen', () => {
    expect(segmentContent('')).toEqual([])
  })
})
