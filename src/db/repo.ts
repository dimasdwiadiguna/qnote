import { db } from './db'
import { newId, nowIso } from '../lib/id'
import { keyBetween, sortByOrder } from './ordering'
import { blockTitleKey, reindexBlock, reindexIncomingLinks, searchNormFor } from './indexing'
import { enqueue, enqueueMany } from './outbox'
import { ROOT, type Block, type BlockType, type Document } from './types'

/**
 * Semua operasi pohon outline. Satu-satunya lapisan yang menulis ke `blocks`.
 *
 * Prinsip: setiap operasi menulis SESEDIKIT mungkin baris. Indent membawa
 * seluruh anak tanpa menyentuh satu pun baris anak — mereka menunjuk
 * `parent_id` blok yang dipindah, jadi cukup satu baris berubah. Ini bukan
 * optimasi kosmetik: satu operasi = satu baris = satu konflik sync maksimum.
 */

const MUTABLE_TABLES = [
  'documents',
  'blocks',
  'tags',
  'categories',
  'block_tags',
  'block_categories',
  'block_links',
  'review_states',
  'outbox',
  'meta',
] as const

/** Menjalankan `fn` dalam satu transaksi read-write di seluruh tabel mutable. */
export function rw<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', MUTABLE_TABLES as unknown as string[], fn)
}

// ── documents ─────────────────────────────────────────────────────────────────

export async function listDocuments(): Promise<Document[]> {
  const rows = await db.documents.toArray()
  return sortByOrder(rows.filter((d) => !d.deleted_at))
}

export async function createDocument(title = 'Catatan baru'): Promise<Document> {
  return rw(async () => {
    const existing = await listDocuments()
    const last = existing[existing.length - 1]
    const now = nowIso()
    const doc: Document = {
      id: newId(),
      title,
      order_key: keyBetween(last?.order_key ?? null, null),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    await db.documents.put(doc)
    await enqueue('documents', doc.id)
    return doc
  })
}

/**
 * Dokumen default, aman terhadap pemanggilan ganda.
 *
 * Ini bukan kehati-hatian teoretis: React StrictMode menjalankan efek boot dua
 * kali, dan dua `createDocument` yang berlomba menghasilkan DUA dokumen kosong.
 * Yang kedua bisa menang saat urutan dibaca ulang setelah reload — dan catatan
 * terlihat "hilang" padahal masih ada di dokumen yang satunya.
 */
let defaultDocumentPromise: Promise<Document> | null = null

export function ensureDefaultDocument(): Promise<Document> {
  if (!defaultDocumentPromise) {
    defaultDocumentPromise = rw(async () => {
      const existing = await listDocuments()
      if (existing[0]) return existing[0]
      const now = nowIso()
      const doc: Document = {
        id: newId(),
        title: 'Tadabbur',
        order_key: keyBetween(null, null),
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }
      await db.documents.put(doc)
      await enqueue('documents', doc.id)
      return doc
    }).catch((error: unknown) => {
      defaultDocumentPromise = null
      throw error
    })
  }
  return defaultDocumentPromise
}

export async function renameDocument(id: string, title: string): Promise<void> {
  await rw(async () => {
    const doc = await db.documents.get(id)
    if (!doc) return
    await db.documents.put({ ...doc, title, updated_at: nowIso() })
    await enqueue('documents', id)
  })
}

export async function deleteDocument(id: string): Promise<void> {
  await rw(async () => {
    const now = nowIso()
    const doc = await db.documents.get(id)
    if (!doc) return
    await db.documents.put({ ...doc, deleted_at: now, updated_at: now })
    await enqueue('documents', id)
    const blocks = await db.blocks.where('document_id').equals(id).toArray()
    const live = blocks.filter((b) => !b.deleted_at)
    if (live.length > 0) {
      await db.blocks.bulkPut(live.map((b) => ({ ...b, deleted_at: now, updated_at: now })))
      await enqueueMany(
        'blocks',
        live.map((b) => b.id),
      )
    }
  })
}

// ── membaca pohon ─────────────────────────────────────────────────────────────

export async function loadDocumentBlocks(documentId: string): Promise<Block[]> {
  const rows = await db.blocks.where('document_id').equals(documentId).toArray()
  return rows.filter((b) => !b.deleted_at)
}

async function siblingsOf(block: Block): Promise<Block[]> {
  const rows = await db.blocks
    .where('[document_id+parent_id]')
    .equals([block.document_id, block.parent_id])
    .toArray()
  return sortByOrder(rows.filter((b) => !b.deleted_at))
}

async function childrenOf(documentId: string, parentId: string): Promise<Block[]> {
  const rows = await db.blocks
    .where('[document_id+parent_id]')
    .equals([documentId, parentId])
    .toArray()
  return sortByOrder(rows.filter((b) => !b.deleted_at))
}

export async function hasChildren(blockId: string): Promise<boolean> {
  const rows = await db.blocks.where('parent_id').equals(blockId).toArray()
  return rows.some((b) => !b.deleted_at)
}

/** Rantai leluhur dari akar dokumen sampai blok (untuk breadcrumb zoom). */
export async function ancestorChain(blockId: string): Promise<Block[]> {
  const chain: Block[] = []
  let current = await db.blocks.get(blockId)
  const guard = new Set<string>()
  while (current && !guard.has(current.id)) {
    guard.add(current.id)
    chain.unshift(current)
    if (current.parent_id === ROOT) break
    current = await db.blocks.get(current.parent_id)
  }
  return chain
}

// ── membuat blok ──────────────────────────────────────────────────────────────

interface NewBlockInput {
  documentId: string
  parentId: string
  orderKey: string
  blockType?: BlockType
  content?: string
  ayatSurah?: number | null
  ayatNumber?: number | null
}

function makeBlock(input: NewBlockInput): Block {
  const now = nowIso()
  const content = input.content ?? ''
  return {
    id: newId(),
    document_id: input.documentId,
    parent_id: input.parentId,
    order_key: input.orderKey,
    block_type: input.blockType ?? 'text',
    content,
    search_norm: searchNormFor(content),
    is_promoted: 0,
    is_collapsed: 0,
    ayat_surah: input.ayatSurah ?? null,
    ayat_number: input.ayatNumber ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
}

/** Bullet pertama sebuah dokumen (atau anak pertama saat zoom ke blok kosong). */
export async function createFirstBlock(
  documentId: string,
  parentId: string = ROOT,
): Promise<string> {
  return rw(async () => {
    const children = await childrenOf(documentId, parentId)
    const block = makeBlock({
      documentId,
      parentId,
      orderKey: keyBetween(children[children.length - 1]?.order_key ?? null, null),
    })
    await db.blocks.put(block)
    await enqueue('blocks', block.id)
    return block.id
  })
}

/** Bullet baru sebagai SAUDARA tepat setelah `afterId`. */
export async function createSiblingAfter(
  afterId: string,
  init: Partial<NewBlockInput> = {},
): Promise<string | null> {
  return rw(async () => {
    const anchor = await db.blocks.get(afterId)
    if (!anchor) return null
    const siblings = await siblingsOf(anchor)
    const index = siblings.findIndex((b) => b.id === afterId)
    const next = index === -1 ? undefined : siblings[index + 1]
    const block = makeBlock({
      documentId: anchor.document_id,
      parentId: anchor.parent_id,
      orderKey: keyBetween(anchor.order_key, next?.order_key ?? null),
      ...init,
    })
    await db.blocks.put(block)
    await enqueue('blocks', block.id)
    if (block.content) await reindexBlock(block.id)
    return block.id
  })
}

/**
 * Bullet baru sebagai ANAK PERTAMA dari `parentId`.
 * Ini jalur `Enter` pada baris anotasi kartu ayat: blok ayat tidak pernah
 * dipecah — Enter membuat anak (brief §5).
 */
export async function createChildFirst(
  parentId: string,
  init: Partial<NewBlockInput> = {},
): Promise<string | null> {
  return rw(async () => {
    const parent = await db.blocks.get(parentId)
    if (!parent) return null
    const children = await childrenOf(parent.document_id, parentId)
    const block = makeBlock({
      documentId: parent.document_id,
      parentId,
      orderKey: keyBetween(null, children[0]?.order_key ?? null),
      ...init,
    })
    await db.blocks.put(block)
    await enqueue('blocks', block.id)
    // Parent yang tadinya ter-collapse harus terbuka, kalau tidak anak barunya
    // langsung tidak terlihat dan kursor pindah ke tempat yang tak tampak.
    if (parent.is_collapsed) {
      await db.blocks.put({ ...parent, is_collapsed: 0, updated_at: nowIso() })
      await enqueue('blocks', parent.id)
    }
    if (block.content) await reindexBlock(block.id)
    return block.id
  })
}

// ── mengubah isi ──────────────────────────────────────────────────────────────

export async function updateContent(id: string, content: string): Promise<void> {
  await rw(async () => {
    const block = await db.blocks.get(id)
    if (!block || block.content === content) return
    const previousTitle = block.is_promoted ? blockTitleKey(block) : ''
    const next: Block = {
      ...block,
      content,
      search_norm: searchNormFor(content),
      updated_at: nowIso(),
    }
    await db.blocks.put(next)
    await enqueue('blocks', id)
    await reindexBlock(id)
    if (block.is_promoted) {
      const nextTitle = blockTitleKey(next)
      if (nextTitle !== previousTitle) {
        await reindexIncomingLinks([previousTitle, nextTitle])
      }
    }
  })
}

export async function toggleCollapse(id: string): Promise<void> {
  await rw(async () => {
    const block = await db.blocks.get(id)
    if (!block) return
    await db.blocks.put({
      ...block,
      is_collapsed: block.is_collapsed ? 0 : 1,
      updated_at: nowIso(),
    })
    await enqueue('blocks', id)
  })
}

/**
 * Promosi adalah FLAG, bukan migrasi data (brief §2.4). Tidak ada perpindahan
 * baris; bisa dibatalkan kapan saja. Yang berubah hanya tiga hal: blok bisa
 * jadi target wiki-link, punya panel backlink, dan masuk antrian drill.
 */
export async function setPromoted(id: string, promoted: boolean): Promise<void> {
  await rw(async () => {
    const block = await db.blocks.get(id)
    if (!block || Boolean(block.is_promoted) === promoted) return
    await db.blocks.put({
      ...block,
      is_promoted: promoted ? 1 : 0,
      updated_at: nowIso(),
    })
    await enqueue('blocks', id)
    // Link yang menunjuk judul ini jadi valid / tidak valid.
    await reindexIncomingLinks([blockTitleKey(block)])
  })
}

export async function setAyatCollapsedFlag(id: string, collapsed: boolean): Promise<void> {
  await rw(async () => {
    const block = await db.blocks.get(id)
    if (!block) return
    await db.blocks.put({ ...block, is_collapsed: collapsed ? 1 : 0, updated_at: nowIso() })
    await enqueue('blocks', id)
  })
}

// ── indent / outdent ──────────────────────────────────────────────────────────

/** Indent: jadi anak terakhir dari saudara sebelumnya. Anak ikut otomatis. */
export async function indentBlock(id: string): Promise<boolean> {
  return rw(async () => {
    const block = await db.blocks.get(id)
    if (!block) return false
    const siblings = await siblingsOf(block)
    const index = siblings.findIndex((b) => b.id === id)
    const previous = index > 0 ? siblings[index - 1] : undefined
    if (!previous) return false
    const nephews = await childrenOf(block.document_id, previous.id)
    await db.blocks.put({
      ...block,
      parent_id: previous.id,
      order_key: keyBetween(nephews[nephews.length - 1]?.order_key ?? null, null),
      updated_at: nowIso(),
    })
    await enqueue('blocks', id)
    if (previous.is_collapsed) {
      await db.blocks.put({ ...previous, is_collapsed: 0, updated_at: nowIso() })
      await enqueue('blocks', previous.id)
    }
    return true
  })
}

/** Outdent: jadi saudara tepat setelah parent-nya. Anak ikut otomatis. */
export async function outdentBlock(id: string): Promise<boolean> {
  return rw(async () => {
    const block = await db.blocks.get(id)
    if (!block || block.parent_id === ROOT) return false
    const parent = await db.blocks.get(block.parent_id)
    if (!parent) return false
    const parentSiblings = await childrenOf(parent.document_id, parent.parent_id)
    const index = parentSiblings.findIndex((b) => b.id === parent.id)
    const afterParent = index === -1 ? undefined : parentSiblings[index + 1]
    await db.blocks.put({
      ...block,
      parent_id: parent.parent_id,
      order_key: keyBetween(parent.order_key, afterParent?.order_key ?? null),
      updated_at: nowIso(),
    })
    await enqueue('blocks', id)
    return true
  })
}

// ── memindahkan ───────────────────────────────────────────────────────────────

export async function moveBlock(
  id: string,
  newParentId: string,
  beforeId: string | null,
): Promise<void> {
  await rw(async () => {
    const block = await db.blocks.get(id)
    if (!block) return
    const siblings = (await childrenOf(block.document_id, newParentId)).filter(
      (b) => b.id !== id,
    )
    const index = beforeId ? siblings.findIndex((b) => b.id === beforeId) : siblings.length
    const before = index === -1 ? undefined : siblings[index]
    const after = index <= 0 ? undefined : siblings[index - 1]
    await db.blocks.put({
      ...block,
      parent_id: newParentId,
      order_key: keyBetween(after?.order_key ?? null, before?.order_key ?? null),
      updated_at: nowIso(),
    })
    await enqueue('blocks', id)
  })
}

// ── menghapus ─────────────────────────────────────────────────────────────────

async function collectSubtree(rootId: string, documentId: string): Promise<Block[]> {
  const all = await db.blocks.where('document_id').equals(documentId).toArray()
  const byParent = new Map<string, Block[]>()
  for (const block of all) {
    if (block.deleted_at) continue
    const list = byParent.get(block.parent_id)
    if (list) list.push(block)
    else byParent.set(block.parent_id, [block])
  }
  const out: Block[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const self = all.find((b) => b.id === id)
    if (self && !self.deleted_at) out.push(self)
    for (const child of byParent.get(id) ?? []) stack.push(child.id)
  }
  return out
}

export async function countDescendants(id: string, documentId: string): Promise<number> {
  const subtree = await collectSubtree(id, documentId)
  return Math.max(0, subtree.length - 1)
}

/** Soft delete blok beserta seluruh keturunannya. Hard delete DILARANG. */
export async function deleteBlock(id: string): Promise<void> {
  await rw(async () => {
    const block = await db.blocks.get(id)
    if (!block) return
    const subtree = await collectSubtree(id, block.document_id)
    const now = nowIso()
    await db.blocks.bulkPut(subtree.map((b) => ({ ...b, deleted_at: now, updated_at: now })))
    await enqueueMany(
      'blocks',
      subtree.map((b) => b.id),
    )
    for (const removed of subtree) {
      await reindexBlock(removed.id)
    }
    const promotedTitles = subtree.filter((b) => b.is_promoted).map((b) => blockTitleKey(b))
    await reindexIncomingLinks(promotedTitles)
  })
}

/**
 * `Backspace` di awal bullet kosong = gabung ke bullet sebelumnya.
 * Menolak bila blok punya anak (agar tidak ada subtree yatim) dan bila blok
 * bertipe ayat — ayat hanya dihapus lewat aksi eksplisit (brief §5).
 */
export async function mergeIntoPrevious(
  id: string,
  previousId: string,
): Promise<{ ok: boolean; caretAt: number }> {
  return rw(async () => {
    const block = await db.blocks.get(id)
    const previous = await db.blocks.get(previousId)
    if (!block || !previous) return { ok: false, caretAt: 0 }
    if (block.block_type === 'ayat' || previous.block_type === 'ayat') {
      return { ok: false, caretAt: 0 }
    }
    const kids = await childrenOf(block.document_id, id)
    if (kids.length > 0) return { ok: false, caretAt: 0 }

    const caretAt = previous.content.length
    const merged = previous.content + block.content
    const now = nowIso()
    await db.blocks.put({ ...block, deleted_at: now, updated_at: now })
    await enqueue('blocks', id)
    await reindexBlock(id)
    if (merged !== previous.content) {
      await db.blocks.put({
        ...previous,
        content: merged,
        search_norm: searchNormFor(merged),
        updated_at: now,
      })
      await enqueue('blocks', previousId)
      await reindexBlock(previousId)
    }
    return { ok: true, caretAt }
  })
}

// ── ayat ──────────────────────────────────────────────────────────────────────

/**
 * Menyisipkan blok ayat pada posisi kursor: SEJAJAR dengan bullet aktif, bukan
 * dipaksa jadi anak (brief §5). Bila bullet aktif masih kosong dan bertipe
 * teks, blok itu dikonversi di tempat supaya tidak meninggalkan bullet yatim.
 */
export async function insertAyatBlock(
  anchorId: string | null,
  documentId: string,
  parentId: string,
  surah: number,
  number: number,
): Promise<string | null> {
  return rw(async () => {
    const anchor = anchorId ? await db.blocks.get(anchorId) : undefined

    if (anchor && anchor.block_type === 'text' && anchor.content.trim() === '') {
      const converted: Block = {
        ...anchor,
        block_type: 'ayat',
        ayat_surah: surah,
        ayat_number: number,
        updated_at: nowIso(),
      }
      await db.blocks.put(converted)
      await enqueue('blocks', converted.id)
      return converted.id
    }

    if (anchor) {
      return createSiblingAfter(anchor.id, {
        blockType: 'ayat',
        ayatSurah: surah,
        ayatNumber: number,
      })
    }

    const children = await childrenOf(documentId, parentId)
    const block = makeBlock({
      documentId,
      parentId,
      orderKey: keyBetween(children[children.length - 1]?.order_key ?? null, null),
      blockType: 'ayat',
      ayatSurah: surah,
      ayatNumber: number,
    })
    await db.blocks.put(block)
    await enqueue('blocks', block.id)
    return block.id
  })
}
