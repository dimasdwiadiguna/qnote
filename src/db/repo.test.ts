import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { appendAyatNote, createDocument } from './repo'
import { ROOT, type Block } from './types'

/**
 * Bentuk data anotasi dari layar pembaca Qur'an.
 *
 * Ini klaim inti rancangannya: beberapa ayat disimpan sebagai INDUK teks +
 * anak-anak ayat, tanpa kolom baru. Kalau bentuk ini bergeser, aturan
 * keterkaitan drill Mode A (parent–anak langsung) diam-diam ikut rusak.
 */

async function reset(): Promise<void> {
  await db.delete()
  await db.open()
}

const childrenOf = async (parentId: string): Promise<Block[]> => {
  const rows = await db.blocks.where('parent_id').equals(parentId).toArray()
  return rows.filter((b) => !b.deleted_at).sort((a, b) => a.order_key.localeCompare(b.order_key))
}

describe('appendAyatNote', () => {
  let documentId = ''

  beforeEach(async () => {
    await reset()
    documentId = (await createDocument('Uji')).id
  })

  it('satu ayat → satu blok ayat, anotasi jadi content-nya', async () => {
    const id = await appendAyatNote(documentId, [{ surah: 2, number: 153 }], 'sabar dan salat')
    expect(id).toBeTruthy()

    const block = await db.blocks.get(id as string)
    expect(block?.block_type).toBe('ayat')
    expect(block?.ayat_surah).toBe(2)
    expect(block?.ayat_number).toBe(153)
    expect(block?.content).toBe('sabar dan salat')
    expect(block?.parent_id).toBe(ROOT)
    expect(await childrenOf(id as string)).toHaveLength(0)
  })

  it('banyak ayat → induk teks beranotasi + anak ayat berurutan', async () => {
    const id = await appendAyatNote(
      documentId,
      [
        { surah: 2, number: 153 },
        { surah: 2, number: 154 },
        { surah: 2, number: 155 },
      ],
      'penopang saat ujian',
    )

    const parent = await db.blocks.get(id as string)
    expect(parent?.block_type).toBe('text')
    expect(parent?.content).toBe('penopang saat ujian')
    expect(parent?.ayat_surah).toBeNull()

    const children = await childrenOf(id as string)
    expect(children).toHaveLength(3)
    expect(children.map((c) => c.block_type)).toEqual(['ayat', 'ayat', 'ayat'])
    expect(children.map((c) => c.ayat_number)).toEqual([153, 154, 155])
    expect(children.every((c) => c.parent_id === id)).toBe(true)
    expect(children.every((c) => c.document_id === documentId)).toBe(true)
  })

  it('order_key anak menaik, jadi urutan tampilan mengikuti urutan ayat', async () => {
    const id = await appendAyatNote(
      documentId,
      [
        { surah: 2, number: 1 },
        { surah: 2, number: 2 },
        { surah: 2, number: 3 },
      ],
      'catatan',
    )
    const keys = (await childrenOf(id as string)).map((c) => c.order_key)
    expect([...keys].sort()).toEqual(keys)
  })

  it('penanda di anotasi ikut terindeks', async () => {
    const id = await appendAyatNote(
      documentId,
      [{ surah: 2, number: 153 }],
      'tentang #sabar [aqidah]',
    )
    const tags = await db.block_tags.where('block_id').equals(id as string).toArray()
    const categories = await db.block_categories
      .where('block_id')
      .equals(id as string)
      .toArray()
    expect(tags).toHaveLength(1)
    expect(categories).toHaveLength(1)
  })

  it('anotasi kosong tetap boleh — ayat tersimpan tanpa catatan', async () => {
    const id = await appendAyatNote(documentId, [{ surah: 112, number: 1 }], '')
    const block = await db.blocks.get(id as string)
    expect(block?.content).toBe('')
    expect(block?.ayat_surah).toBe(112)
  })

  it('pilihan kosong tidak menulis apa pun', async () => {
    const before = await db.blocks.count()
    expect(await appendAyatNote(documentId, [], 'apa pun')).toBeNull()
    expect(await db.blocks.count()).toBe(before)
  })

  it('catatan berturut-turut tidak saling menimpa di akar', async () => {
    const first = await appendAyatNote(documentId, [{ surah: 2, number: 1 }], 'satu')
    const second = await appendAyatNote(documentId, [{ surah: 2, number: 2 }], 'dua')
    const roots = await childrenOf(ROOT)
    expect(roots.map((r) => r.id)).toEqual([first, second])
  })

  it('setiap blok baru masuk outbox untuk sync', async () => {
    await db.outbox.clear()
    const id = await appendAyatNote(
      documentId,
      [
        { surah: 2, number: 153 },
        { surah: 2, number: 154 },
      ],
      'x',
    )
    const rows = await db.outbox.where('table').equals('blocks').toArray()
    const ids = new Set(rows.map((r) => r.row_id))
    expect(ids.has(id as string)).toBe(true)
    expect(ids.size).toBe(3) // induk + dua anak
  })
})
