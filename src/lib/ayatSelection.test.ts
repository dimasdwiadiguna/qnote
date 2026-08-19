import { describe, expect, it } from 'vitest'
import { extendRange, formatSelection, selectionToRefs, toggleAyat } from './ayatSelection'

const set = (...keys: string[]): Set<string> => new Set(keys)

describe('toggleAyat', () => {
  it('menambah bila belum terpilih', () => {
    expect([...toggleAyat(set(), '2:153')]).toEqual(['2:153'])
  })

  it('membuang bila sudah terpilih — gestur yang sama', () => {
    expect([...toggleAyat(set('2:153'), '2:153')]).toEqual([])
  })

  it('tidak mengubah himpunan asal', () => {
    const original = set('2:153')
    toggleAyat(original, '2:154')
    expect([...original]).toEqual(['2:153'])
  })
})

describe('extendRange', () => {
  it('rentang maju', () => {
    expect([...extendRange(set('2:153'), '2:153', '2:155')].sort()).toEqual([
      '2:153',
      '2:154',
      '2:155',
    ])
  })

  it('rentang MUNDUR — menahan ayat di atas jangkar', () => {
    expect([...extendRange(set('2:155'), '2:155', '2:153')].sort()).toEqual([
      '2:153',
      '2:154',
      '2:155',
    ])
  })

  it('satu ayat saja bila jangkar sama dengan target', () => {
    expect([...extendRange(set(), '2:153', '2:153')]).toEqual(['2:153'])
  })

  it('menggabung dengan pilihan yang sudah ada', () => {
    const result = extendRange(set('2:100'), '2:153', '2:154')
    expect([...result].sort()).toEqual(['2:100', '2:153', '2:154'])
  })

  it('lintas surah tidak membentuk rentang, hanya menambah target', () => {
    const result = extendRange(set('2:153'), '2:153', '3:8')
    expect([...result].sort()).toEqual(['2:153', '3:8'])
  })

  it('jangkar tidak sah diperlakukan sebagai pilih tunggal', () => {
    expect([...extendRange(set(), 'bukan-kunci', '2:153')]).toEqual(['2:153'])
  })

  it('target tidak sah diabaikan', () => {
    expect([...extendRange(set('2:153'), '2:153', 'ngawur')]).toEqual(['2:153'])
  })
})

describe('selectionToRefs', () => {
  it('selalu urut naik meski dipilih acak', () => {
    const refs = selectionToRefs(set('2:155', '2:153', '2:154'))
    expect(refs.map((r) => r.number)).toEqual([153, 154, 155])
  })

  it('urut surah lebih dulu, baru nomor', () => {
    const refs = selectionToRefs(set('3:8', '2:255', '2:1'))
    expect(refs).toEqual([
      { surah: 2, number: 1 },
      { surah: 2, number: 255 },
      { surah: 3, number: 8 },
    ])
  })

  it('kunci tidak sah dibuang', () => {
    expect(selectionToRefs(set('2:153', 'rusak', ''))).toEqual([{ surah: 2, number: 153 }])
  })
})

describe('formatSelection', () => {
  it('ayat tunggal', () => {
    expect(formatSelection(selectionToRefs(set('2:153')))).toBe('QS 2:153')
  })

  it('deretan berurutan dirapatkan', () => {
    expect(formatSelection(selectionToRefs(set('2:153', '2:154', '2:155')))).toBe(
      'QS 2:153–155',
    )
  })

  it('lompatan dipisah, surah tidak diulang', () => {
    expect(formatSelection(selectionToRefs(set('2:153', '2:154', '2:160')))).toBe(
      'QS 2:153–154, 160',
    )
  })

  it('beda surah menyebut surahnya lagi', () => {
    expect(formatSelection(selectionToRefs(set('2:153', '3:8')))).toBe('QS 2:153, 3:8')
  })

  it('kosong', () => {
    expect(formatSelection([])).toBe('')
  })
})
