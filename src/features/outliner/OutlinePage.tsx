import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useVirtualizer } from '@tanstack/react-virtual'

import { db, getMeta, META, setMeta } from '../../db/db'
import {
  createChildFirst,
  createFirstBlock,
  createSiblingAfter,
  deleteBlock,
  indentBlock,
  insertAyatBlock,
  listDocuments,
  loadDocumentBlocks,
  mergeIntoPrevious,
  outdentBlock,
  setPromoted,
  toggleCollapse,
  updateContent,
} from '../../db/repo'
import { ROOT, type Ayat, type Block, type SurahMeta } from '../../db/types'
import { applyCompletion, detectTrigger, removeTrigger, type Trigger } from '../../lib/autocomplete'
import { computeInheritance, type CategoryAssignment } from '../../lib/inherit'
import { ancestorsOf, buildTree, flattenTree, type FlatNode } from '../../lib/tree'
import { useDebouncedSave } from '../../ui/hooks'
import type { Route } from '../../ui/router'

import { AutocompletePanel } from './AutocompletePanel'
import { AyatPicker } from './AyatPicker'
import { BacklinkPanel } from './BacklinkPanel'
import { BlockMenu } from './BlockMenu'
import { BlockRow } from './BlockRow'
import type { BlockEditorHandle } from './BlockEditor'
import { DocSwitcher } from './DocSwitcher'
import { MobileToolbar, type ToolbarAction } from './MobileToolbar'

const EMPTY_CATEGORIES: CategoryAssignment = { direct: [], inherited: [] }

/** Di bawah ambang ini, render langsung — virtualisasi tidak membayar dirinya. */
const VIRTUALIZE_THRESHOLD = 80

export interface OutlinePageProps {
  route: Route
  navigate: (patch: Partial<Route>, replace?: boolean) => void
  /** Memberi tahu shell bahwa toolbar editor sedang menempati bilah bawah. */
  onEditingChange?: (editing: boolean) => void
}

export function OutlinePage({
  route,
  navigate,
  onEditingChange,
}: OutlinePageProps): JSX.Element {
  // ── data ────────────────────────────────────────────────────────────────────
  const documents = useLiveQuery(() => listDocuments(), [], [])
  const documentId = route.documentId ?? documents[0]?.id ?? null

  const blocks = useLiveQuery(
    () => (documentId ? loadDocumentBlocks(documentId) : Promise.resolve([])),
    [documentId],
    [] as Block[],
  )

  const categoryData = useLiveQuery(
    async () => {
      const [links, categories] = await Promise.all([
        db.block_categories.toArray(),
        db.categories.toArray(),
      ])
      const pathById = new Map(
        categories.filter((c) => !c.deleted_at).map((c) => [c.id, c.path]),
      )
      const byBlock = new Map<string, string[]>()
      for (const link of links) {
        if (link.deleted_at) continue
        const path = pathById.get(link.category_id)
        if (!path) continue
        const list = byBlock.get(link.block_id)
        if (list) {
          if (!list.includes(path)) list.push(path)
        } else byBlock.set(link.block_id, [path])
      }
      return byBlock
    },
    [],
    new Map<string, string[]>(),
  )

  const tree = useMemo(() => buildTree(blocks), [blocks])
  const zoomId = route.zoom && tree.byId.has(route.zoom) ? route.zoom : null
  const rootId = zoomId ?? ROOT
  const nodes = useMemo(() => flattenTree(tree, rootId), [tree, rootId])
  const nodesRef = useRef<FlatNode[]>(nodes)
  nodesRef.current = nodes

  /**
   * Saat zoom-in, kategori leluhur di ATAS akar tampilan tetap harus diwariskan
   * ke bawah — kalau tidak, zoom akan diam-diam menghilangkan konteks kategori.
   */
  const inheritedSeed = useMemo(() => {
    if (!zoomId) return [] as string[]
    const seed = new Set<string>()
    for (const ancestor of ancestorsOf(tree, zoomId)) {
      for (const path of categoryData.get(ancestor.id) ?? []) seed.add(path)
    }
    return [...seed]
  }, [tree, zoomId, categoryData])

  const inheritance = useMemo(
    () => computeInheritance(nodes, categoryData, inheritedSeed),
    [nodes, categoryData, inheritedSeed],
  )

  // Teks ayat hanya untuk blok ayat yang benar-benar ada di dokumen ini.
  const ayatData = useLiveQuery(
    async () => {
      const keys = new Set<string>()
      const pairs: [number, number][] = []
      for (const block of blocks) {
        if (block.block_type !== 'ayat') continue
        if (block.ayat_surah === null || block.ayat_number === null) continue
        const key = `${block.ayat_surah}:${block.ayat_number}`
        if (keys.has(key)) continue
        keys.add(key)
        pairs.push([block.ayat_surah, block.ayat_number])
      }
      if (pairs.length === 0) {
        return { ayat: new Map<string, Ayat>(), surahs: new Map<number, SurahMeta>() }
      }
      const rows = await db.ayat.bulkGet(pairs)
      const ayat = new Map<string, Ayat>()
      for (const row of rows) {
        if (row) ayat.set(`${row.surah}:${row.number}`, row)
      }
      const surahRows = await db.surahs.bulkGet([...new Set(pairs.map(([s]) => s))])
      const surahs = new Map<number, SurahMeta>()
      for (const row of surahRows) {
        if (row) surahs.set(row.surah, row)
      }
      return { ayat, surahs }
    },
    [blocks],
    { ayat: new Map<string, Ayat>(), surahs: new Map<number, SurahMeta>() },
  )

  // ── state editor ────────────────────────────────────────────────────────────
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [cardsCollapsed, setCardsCollapsed] = useState(false)
  const [cardOverrides, setCardOverrides] = useState<Set<string>>(() => new Set())

  /**
   * Handle textarea SETIAP baris yang sedang ter-render. Karena semua baris
   * memasang textarea sungguhan, memfokus baris lain cukup memanggil handle-nya
   * — tidak perlu menunggu render, dan tidak ada elemen yang dibongkar.
   */
  const editorRefs = useRef(new Map<string, BlockEditorHandle>())
  const pendingFocus = useRef<{
    id: string
    caret: number
    /** Baris yang dikunci selama serah-terima; dibuka saat fokus benar-benar mendarat. */
    source?: BlockEditorHandle
  } | null>(null)
  const focusedIdRef = useRef<string | null>(null)
  focusedIdRef.current = focusedId
  const scrollRef = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<number | null>(null)
  /**
   * Bullet terakhir yang disentuh, TIDAK ikut hilang saat blur. Membuka palet
   * ayat memindahkan fokus ke kolom pencarian, dan tanpa jangkar ini ayat akan
   * disisipkan di akhir dokumen alih-alih di posisi kursor tadi.
   */
  const anchorRef = useRef<string | null>(null)
  /** Catatan baru: fokuskan bullet pertamanya begitu efek dokumen-kosong membuatnya. */
  const wantFirstBullet = useRef(false)

  const registerEditor = useCallback((id: string, handle: BlockEditorHandle | null): void => {
    if (handle) editorRefs.current.set(id, handle)
    else if (editorRefs.current.get(id)) editorRefs.current.delete(id)
  }, [])

  const activeEditor = useCallback((): BlockEditorHandle | undefined => {
    const id = focusedIdRef.current ?? anchorRef.current
    return id ? editorRefs.current.get(id) : undefined
  }, [])

  const { push, flush } = useDebouncedSave(async (id, value) => {
    await updateContent(id, value)
  })

  /** Menyimpan isi textarea SEKARANG — dipanggil sebelum setiap operasi struktur. */
  const commitNow = useCallback(async (): Promise<void> => {
    const id = focusedIdRef.current ?? anchorRef.current
    const element = id ? editorRefs.current.get(id) : undefined
    await flush()
    if (id && element) await updateContent(id, element.getValue())
  }, [flush])

  /**
   * Mendaratkan fokus di `id`, DAN baru di situ membuka kunci baris asal.
   * Urutannya penting: kunci harus bertahan sampai fokus benar-benar pindah.
   * Kalau dibuka lebih awal, huruf yang diketik pada sisa celah kembali
   * mendarat di bullet lama — persis bug yang hendak ditutup.
   */
  const applyFocus = useCallback(
    (handle: BlockEditorHandle, id: string, caret: number, source?: BlockEditorHandle): void => {
      const typed = source ? source.release() : ''
      if (typed.length > 0) {
        const next = handle.getValue() + typed
        handle.setValue(next, next.length)
        push(id, next)
        handle.focus(next.length)
        return
      }
      handle.focus(caret)
    },
    [push],
  )

  const focusBlock = useCallback(
    (id: string, caret: number, source?: BlockEditorHandle): void => {
      if (blurTimer.current !== null) {
        window.clearTimeout(blurTimer.current)
        blurTimer.current = null
      }
      anchorRef.current = id
      setFocusedId(id)
      setTrigger(null)
      const handle = editorRefs.current.get(id)
      if (handle) applyFocus(handle, id, caret, source)
      // Baris baru belum ter-render; fokuskan segera setelah render berikutnya.
      else pendingFocus.current = { id, caret, source }
    },
    [applyFocus],
  )

  useEffect(() => {
    const wanted = pendingFocus.current
    if (!wanted) return
    const handle = editorRefs.current.get(wanted.id)
    if (!handle) return
    pendingFocus.current = null
    applyFocus(handle, wanted.id, wanted.caret, wanted.source)
  })

  useEffect(() => {
    if (!wantFirstBullet.current) return
    const first = nodes[0]
    if (!first) return
    wantFirstBullet.current = false
    focusBlock(first.block.id, 0)
  }, [nodes, focusBlock])

  useEffect(() => {
    onEditingChange?.(focusedId !== null)
  }, [focusedId, onEditingChange])

  useEffect(
    () => () => {
      if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
      onEditingChange?.(false)
    },
    [onEditingChange],
  )

  useEffect(() => {
    void getMeta<boolean>(META.ayatCardsCollapsed, false).then(setCardsCollapsed)
  }, [])

  // Dibuka dari layar lain (hasil pencarian, kandidat, drill) → langsung fokus.
  useEffect(() => {
    if (!route.focus) return
    if (!tree.byId.has(route.focus)) return
    focusBlock(route.focus, -1)
    navigate({ focus: null }, true)
  }, [route.focus, tree, focusBlock, navigate])

  // Dokumen kosong: selalu sediakan satu bullet supaya ada tempat mengetik.
  useEffect(() => {
    if (!documentId) return
    if (blocks.length > 0) return
    void createFirstBlock(documentId, ROOT)
  }, [documentId, blocks.length])

  const nodeOf = useCallback(
    (blockId: string): { node: FlatNode; index: number } | null => {
      const index = nodesRef.current.findIndex((n) => n.block.id === blockId)
      if (index === -1) return null
      return { node: nodesRef.current[index] as FlatNode, index }
    },
    [],
  )

  const currentBlock = focusedId ? tree.byId.get(focusedId) : undefined

  // ── autosave & autocomplete ────────────────────────────────────────────────

  const handleInput = useCallback(
    (blockId: string, value: string, caret: number): void => {
      push(blockId, value)

      const detected = detectTrigger(value, caret)
      if (detected?.kind === 'ayat') {
        const element = editorRefs.current.get(blockId)
        if (element) {
          const next = removeTrigger(value, detected, caret)
          element.setValue(next.text, next.caret)
          push(blockId, next.text)
        }
        setTrigger(null)
        setPickerOpen(true)
        return
      }
      setTrigger(detected)
    },
    [push],
  )

  const insertAtCaret = useCallback(
    (snippet: string): void => {
      const element = activeEditor()
      const id = focusedIdRef.current ?? anchorRef.current
      if (!element || !id) return
      const value = element.getValue()
      const caret = element.getCaret()
      const next = value.slice(0, caret) + snippet + value.slice(caret)
      const nextCaret = caret + snippet.length
      element.setValue(next, nextCaret)
      element.focus(nextCaret)
      handleInput(id, next, nextCaret)
    },
    [activeEditor, handleInput],
  )

  const acceptCompletion = useCallback(
    (value: string): void => {
      const element = activeEditor()
      const id = focusedIdRef.current ?? anchorRef.current
      if (!element || !trigger || !id) return
      const result = applyCompletion(element.getValue(), trigger, element.getCaret(), value)
      element.setValue(result.text, result.caret)
      element.focus(result.caret)
      push(id, result.text)
      setTrigger(null)
    },
    [activeEditor, trigger, push],
  )

  // ── operasi struktur ────────────────────────────────────────────────────────

  /**
   * Indent/outdent MEMBAWA SELURUH ANAK tanpa menyentuh satu pun baris anak —
   * mereka menunjuk `parent_id` blok yang dipindah, jadi cukup satu baris
   * berubah (lihat repo.ts). Kursor dikembalikan ke tempat semula supaya
   * mengetik bisa langsung dilanjutkan.
   */
  const doIndent = useCallback(async (): Promise<void> => {
    const id = focusedIdRef.current ?? anchorRef.current
    if (!id) return
    const caret = editorRefs.current.get(id)?.getCaret() ?? 0
    await commitNow()
    if (await indentBlock(id)) focusBlock(id, caret)
  }, [commitNow, focusBlock])

  const doOutdent = useCallback(async (): Promise<void> => {
    const id = focusedIdRef.current ?? anchorRef.current
    if (!id) return
    const caret = editorRefs.current.get(id)?.getCaret() ?? 0
    await commitNow()
    if (await outdentBlock(id)) focusBlock(id, caret)
  }, [commitNow, focusBlock])

  const handleEnter = useCallback(
    async (blockId: string): Promise<void> => {
      const found = nodeOf(blockId)
      const element = editorRefs.current.get(blockId)
      if (!found || !element) return
      const { node } = found
      const value = element.getValue()
      const caret = element.getCaret()
      // Kunci SEBELUM await pertama — celahnya justru ada di antara sini dan
      // saat bullet baru selesai dibuat.
      element.lock()
      await commitNow()

      // Blok ayat TIDAK PERNAH dipecah — Enter membuat anak (brief §5).
      if (node.block.block_type === 'ayat') {
        const created = await createChildFirst(node.block.id)
        if (created) focusBlock(created, 0, element)
        else element.release()
        return
      }

      // Enter di bullet kosong yang ter-indent = outdent.
      if (value.trim() === '' && node.block.parent_id !== ROOT) {
        const moved = await outdentBlock(node.block.id)
        if (moved) focusBlock(node.block.id, 0, element)
        else element.release()
        return
      }

      const head = value.slice(0, caret)
      const tail = value.slice(caret)
      if (tail.length > 0) await updateContent(node.block.id, head)

      // Bullet dengan anak yang sedang terbuka: bullet baru jadi anak pertama,
      // bukan saudara sesudah seluruh subtree — itu yang diharapkan saat menulis.
      const created =
        node.hasChildren && node.block.is_collapsed === 0
          ? await createChildFirst(node.block.id, { content: tail })
          : await createSiblingAfter(node.block.id, { content: tail })
      if (created) focusBlock(created, 0, element)
      else {
        element.release()
        element.focus(caret)
      }
    },
    [nodeOf, commitNow, focusBlock],
  )

  const handleBackspaceAtStart = useCallback(
    async (blockId: string): Promise<void> => {
      const found = nodeOf(blockId)
      const element = editorRefs.current.get(blockId)
      if (!found || !element || found.index <= 0) return
      const previous = nodesRef.current[found.index - 1]
      if (!previous) return

      const value = element.getValue()
      await commitNow()

      // Backspace pada anotasi kosong TIDAK menghapus ayat (brief §5).
      if (found.node.block.block_type === 'ayat') return

      if (value.length === 0) {
        if (found.node.hasChildren) return
        await deleteBlock(found.node.block.id)
        focusBlock(previous.block.id, -1)
        return
      }

      if (found.node.hasChildren || previous.block.block_type === 'ayat') return
      const result = await mergeIntoPrevious(found.node.block.id, previous.block.id)
      if (result.ok) focusBlock(previous.block.id, result.caretAt)
    },
    [nodeOf, commitNow, focusBlock],
  )

  const moveFocus = useCallback(
    (blockId: string, delta: number): void => {
      const found = nodeOf(blockId)
      if (!found) return
      const target = nodesRef.current[found.index + delta]
      if (!target) return
      const caret = editorRefs.current.get(blockId)?.getCaret() ?? 0
      // Tanpa `await` di depan: fokus harus berpindah dalam gestur yang sama,
      // kalau tidak keyboard iOS akan turun. Simpan berjalan di belakang.
      void commitNow()
      focusBlock(target.block.id, delta > 0 ? Math.min(caret, target.block.content.length) : -1)
    },
    [nodeOf, commitNow, focusBlock],
  )

  const handleKeyDown = useCallback(
    (blockId: string, event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      const element = event.currentTarget

      if (event.key === 'Escape') {
        setTrigger(null)
        return
      }

      // `nativeEvent.isComposing` menjaga IME (mis. papan ketik Arab/prediktif)
      // — Enter saat kandidat IME terbuka bukan Enter untuk bullet baru.
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        void handleEnter(blockId)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        void (event.shiftKey ? doOutdent() : doIndent())
        return
      }

      if (
        event.key === 'Backspace' &&
        element.selectionStart === 0 &&
        element.selectionEnd === 0
      ) {
        event.preventDefault()
        void handleBackspaceAtStart(blockId)
        return
      }

      if (event.key === 'ArrowUp' && !element.value.slice(0, element.selectionStart).includes('\n')) {
        event.preventDefault()
        moveFocus(blockId, -1)
        return
      }

      if (event.key === 'ArrowDown' && !element.value.slice(element.selectionStart).includes('\n')) {
        event.preventDefault()
        moveFocus(blockId, 1)
      }
    },
    [handleEnter, doIndent, doOutdent, handleBackspaceAtStart, moveFocus],
  )

  const handleFocus = useCallback((blockId: string): void => {
    if (blurTimer.current !== null) {
      window.clearTimeout(blurTimer.current)
      blurTimer.current = null
    }
    anchorRef.current = blockId
    setFocusedId(blockId)
  }, [])

  /**
   * Melepas fokus setelah jeda pendek. Jedanya perlu: menyentuh tombol toolbar
   * memicu blur sesaat di sebagian browser, dan mengosongkan fokus seketika
   * akan menurunkan toolbar tepat saat jari menyentuhnya.
   */
  const handleBlur = useCallback((): void => {
    void flush()
    if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
    blurTimer.current = window.setTimeout(() => {
      blurTimer.current = null
      setFocusedId(null)
      setTrigger(null)
    }, 220)
  }, [flush])

  const handleCaretMove = useCallback((blockId: string, caret: number): void => {
    const element = editorRefs.current.get(blockId)
    if (element) setTrigger(detectTrigger(element.getValue(), caret))
  }, [])

  // ── ayat ────────────────────────────────────────────────────────────────────

  const handlePickAyat = useCallback(
    async (surah: number, number: number): Promise<void> => {
      if (!documentId) return
      await commitNow()
      // Jangkar, bukan `focusedId` — palet ayat sudah merebut fokus.
      const anchor = anchorRef.current
      const created = await insertAyatBlock(anchor, documentId, rootId, surah, number)
      setPickerOpen(false)
      if (created) focusBlock(created, 0)
    },
    [documentId, rootId, commitNow, focusBlock],
  )

  /**
   * "Tutup semua kartu ayat" MENCIUTKAN TAMPILAN Arab+terjemah jadi chip —
   * dan tidak menyentuh `is_collapsed` sama sekali. Menyembunyikan anak adalah
   * hal yang berbeda; brief §5 meminta keduanya tidak disatukan.
   */
  const toggleAllCards = useCallback((): void => {
    setCardsCollapsed((previous) => {
      const next = !previous
      void setMeta(META.ayatCardsCollapsed, next)
      return next
    })
    setCardOverrides(new Set())
  }, [])

  const toggleOneCard = useCallback((blockId: string): void => {
    setCardOverrides((previous) => {
      const next = new Set(previous)
      if (next.has(blockId)) next.delete(blockId)
      else next.add(blockId)
      return next
    })
  }, [])

  const isCardCollapsed = useCallback(
    (blockId: string): boolean =>
      cardOverrides.has(blockId) ? !cardsCollapsed : cardsCollapsed,
    [cardOverrides, cardsCollapsed],
  )

  // ── virtualisasi ────────────────────────────────────────────────────────────

  const virtualize = nodes.length > VIRTUALIZE_THRESHOLD
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => scrollRef.current,
    // Kartu ayat jauh lebih tinggi dari bullet teks, jadi tinggi diukur nyata
    // lewat measureElement — perkiraan tetap saja untuk scroll awal.
    estimateSize: () => 32,
    overscan: 14,
    getItemKey: (index) => nodes[index]?.block.id ?? index,
  })

  // ── render ──────────────────────────────────────────────────────────────────

  const breadcrumb = zoomId ? ancestorsOf(tree, zoomId) : []
  const zoomBlock = zoomId ? tree.byId.get(zoomId) : undefined
  const menuBlock = menuId ? (tree.byId.get(menuId) ?? null) : null
  const currentDocument = documents.find((d) => d.id === documentId)

  const openDocument = useCallback(
    (id: string): void => {
      setDocsOpen(false)
      setFocusedId(null)
      anchorRef.current = null
      editorRefs.current.clear()
      navigate({ documentId: id, zoom: null, focus: null })
    },
    [navigate],
  )

  const renderRow = (index: number): JSX.Element | null => {
    const node = nodes[index]
    if (!node) return null
    const { block } = node
    const key = `${block.ayat_surah}:${block.ayat_number}`
    return (
      <BlockRow
        node={node}
        categories={inheritance.get(block.id) ?? EMPTY_CATEGORIES}
        ayat={block.block_type === 'ayat' ? ayatData.ayat.get(key) : undefined}
        surah={block.ayat_surah !== null ? ayatData.surahs.get(block.ayat_surah) : undefined}
        ayatCardCollapsed={isCardCollapsed(block.id)}
        onZoom={(id) => {
          void commitNow()
          navigate({ zoom: id, documentId })
        }}
        onToggleCollapse={(id) => void toggleCollapse(id)}
        onToggleAyatCard={toggleOneCard}
        onOpenMenu={setMenuId}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onCaretMove={handleCaretMove}
        register={registerEditor}
      >
        {focusedId === block.id && trigger && (
          <AutocompletePanel
            trigger={trigger}
            onPick={acceptCompletion}
            onDismiss={() => setTrigger(null)}
          />
        )}
      </BlockRow>
    )
  }

  const toolbarActions: ToolbarAction[] = [
    {
      key: 'outdent',
      label: '⇤',
      title: 'Naikkan satu tingkat (anak ikut)',
      onPress: () => void doOutdent(),
    },
    {
      key: 'indent',
      label: '⇥',
      title: 'Jadikan anak bullet di atasnya (anak ikut)',
      onPress: () => void doIndent(),
    },
    { key: 'tag', label: '#', title: 'Sisip tag', onPress: () => insertAtCaret('#') },
    { key: 'category', label: '[ ]', title: 'Sisip kategori', onPress: () => insertAtCaret('[') },
    { key: 'link', label: '[[ ]]', title: 'Sisip wiki-link', onPress: () => insertAtCaret('[[') },
    {
      key: 'ayat',
      label: '+ ayat',
      title: 'Sisip ayat',
      onPress: () => {
        void commitNow()
        setPickerOpen(true)
      },
    },
    {
      key: 'blok',
      label: '★',
      title: currentBlock?.is_promoted ? 'Batalkan jadi blok' : 'Jadikan blok (wiki-link & drill)',
      active: currentBlock?.is_promoted === 1,
      onPress: () => {
        if (!currentBlock) return
        void commitNow().then(() =>
          setPromoted(currentBlock.id, currentBlock.is_promoted !== 1),
        )
      },
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-ink-faint/15 bg-paper/95 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {zoomId ? (
              <nav className="flex flex-wrap items-center gap-1 text-[12px] text-ink-soft">
                <button
                  type="button"
                  onClick={() => navigate({ zoom: null })}
                  className="underline underline-offset-2"
                >
                  {currentDocument?.title ?? 'Catatan'}
                </button>
                {breadcrumb.slice(0, -1).map((ancestor) => (
                  <span key={ancestor.id} className="flex items-center gap-1">
                    <span className="text-ink-faint">/</span>
                    <button
                      type="button"
                      onClick={() => navigate({ zoom: ancestor.id })}
                      className="max-w-[9rem] truncate underline underline-offset-2"
                    >
                      {ancestor.content.trim() || 'bullet'}
                    </button>
                  </span>
                ))}
              </nav>
            ) : (
              <button
                type="button"
                onClick={() => setDocsOpen(true)}
                className="flex min-w-0 items-center gap-1 text-left"
              >
                <span className="truncate text-[17px] font-semibold">
                  {currentDocument?.title ?? 'Qnote'}
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">▾</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={toggleAllCards}
            title="Ciutkan tampilan kartu ayat (anak tetap terlihat)"
            className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] text-ink-soft"
          >
            {cardsCollapsed ? 'Buka kartu' : 'Tutup kartu'}
          </button>
        </div>

        {zoomBlock && (
          <h2 className="mt-0.5 text-[16px] font-medium leading-snug">
            {zoomBlock.block_type === 'ayat'
              ? `QS ${zoomBlock.ayat_surah}:${zoomBlock.ayat_number}`
              : zoomBlock.content.trim() || 'Bullet kosong'}
          </h2>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-40 pt-1">
        {virtualize ? (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {renderRow(item.index)}
              </div>
            ))}
          </div>
        ) : (
          nodes.map((node, index) => <div key={node.block.id}>{renderRow(index)}</div>)
        )}

        {zoomBlock?.is_promoted === 1 && (
          <BacklinkPanel
            blockId={zoomBlock.id}
            onOpen={(source) =>
              navigate({ documentId: source.document_id, zoom: null, focus: source.id })
            }
          />
        )}

        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => {
              void commitNow().then(async () => {
                const last = nodesRef.current[nodesRef.current.length - 1]
                if (!last) return
                const created =
                  last.block.parent_id === rootId
                    ? await createSiblingAfter(last.block.id)
                    : await createChildFirst(rootId === ROOT ? last.block.id : rootId)
                if (created) focusBlock(created, 0)
              })
            }}
            className="mt-1 w-full rounded-lg px-3 py-3 text-left text-[14px] text-ink-faint active:bg-paper-sunk"
          >
            + bullet baru
          </button>
        )}
      </div>

      <MobileToolbar actions={toolbarActions} visible={focusedId !== null} />

      <DocSwitcher
        open={docsOpen}
        activeId={documentId}
        onClose={() => setDocsOpen(false)}
        onPick={openDocument}
        onCreated={(id) => {
          // Bullet pertama dibuat oleh efek dokumen-kosong; tandai supaya
          // langsung difokus begitu ia muncul — duduk di kajian lalu mengetik
          // harus dua sentuhan, bukan tiga.
          wantFirstBullet.current = true
          openDocument(id)
        }}
      />

      <BlockMenu
        block={menuBlock}
        onClose={() => setMenuId(null)}
        onTogglePromote={(block) => {
          void setPromoted(block.id, block.is_promoted !== 1)
          setMenuId(null)
        }}
        onZoom={(id) => {
          setMenuId(null)
          navigate({ zoom: id, documentId })
        }}
        onDelete={(block) => {
          void deleteBlock(block.id)
          setMenuId(null)
          if (focusedIdRef.current === block.id) setFocusedId(null)
        }}
        onShowBacklinks={(id) => {
          setMenuId(null)
          navigate({ zoom: id, documentId })
        }}
      />

      <AyatPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(surah, number) => void handlePickAyat(surah, number)}
      />
    </div>
  )
}
