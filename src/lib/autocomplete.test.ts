import { describe, expect, it } from 'vitest'
import { applyCompletion, detectTrigger } from './autocomplete'

const at = (text: string) => detectTrigger(text, text.length)

describe('detectTrigger', () => {
  it('mengenali tag', () => {
    expect(at('Islam adalah #sis')).toEqual({ kind: 'tag', query: 'sis', start: 13 })
  })

  it('mengenali kategori', () => {
    expect(at('teks [dak')).toEqual({ kind: 'category', query: 'dak', start: 5 })
  })

  it('`[[` menang atas `[` — sama seperti parser', () => {
    expect(at('lihat [[Blok')).toEqual({ kind: 'link', query: 'Blok', start: 6 })
  })

  it('`[[` kosong tetap terdeteksi sebagai link', () => {
    expect(at('lihat [[')).toEqual({ kind: 'link', query: '', start: 6 })
  })

  it('kategori boleh memuat spasi', () => {
    expect(at('teks [dakwah man')).toEqual({ kind: 'category', query: 'dakwah man', start: 5 })
  })

  it('link boleh memuat spasi', () => {
    expect(at('teks [[Blok A yang')).toEqual({
      kind: 'link',
      query: 'Blok A yang',
      start: 5,
    })
  })

  it('kurung yang sudah ditutup tidak lagi memicu', () => {
    expect(at('teks [dakwah] lalu ')).toBeNull()
  })

  it('tag berhenti di spasi', () => {
    expect(at('#sistem lalu ')).toBeNull()
  })

  it('`@` memicu palet ayat', () => {
    expect(at('rujuk @2:15')).toEqual({ kind: 'ayat', query: '2:15', start: 6 })
  })

  it('teks polos tidak memicu apa pun', () => {
    expect(at('teks biasa saja')).toBeNull()
  })
})

describe('applyCompletion', () => {
  it('menutup penanda kategori dan menaruh kursor sesudahnya', () => {
    const text = 'teks [dak'
    const trigger = detectTrigger(text, text.length)!
    const result = applyCompletion(text, trigger, text.length, 'dakwah/manhaj')
    expect(result.text).toBe('teks [dakwah/manhaj] ')
    expect(result.caret).toBe(result.text.length)
  })

  it('menutup penanda wiki-link', () => {
    const text = 'lihat [[Blo'
    const trigger = detectTrigger(text, text.length)!
    expect(applyCompletion(text, trigger, text.length, 'Blok A').text).toBe('lihat [[Blok A]] ')
  })

  it('mempertahankan teks setelah kursor', () => {
    const text = 'a #ta b'
    const trigger = detectTrigger(text, 5)!
    expect(applyCompletion(text, trigger, 5, 'taqwa').text).toBe('a #taqwa  b')
  })
})
