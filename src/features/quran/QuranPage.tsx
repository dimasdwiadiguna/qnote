import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useVirtualizer } from '@tanstack/react-virtual'

import { db, getMeta, META, setMeta } from '../../db/db'
import { appendAyatNote } from '../../db/repo'
import { AYAT_KEY, parseAyatKey, type Ayat, type Block } from '../../db/types'
import {
  extendRange,
  formatSelection,
  selectionToRefs,
  toggleAyat,
} from '../../lib/ayatSelection'
import { blockTitle } from '../../db/indexing'
import type { Route } from '../../ui/router'

import { AyahRow } from './AyahRow'
import { NoteSheet } from './NoteSheet'
import { SurahIndex } from './SurahIndex'

/**
 * Layar Qur'an: baca dulu, catat belakangan.
 *
 * Ini arah yang berlawanan dengan `+ ayat` di outline (catatan → ayat). Di sini
 * ayat yang jadi titik berangkat, dan catatan menyusul — alur yang dipakai saat
 * membaca mushaf, bukan saat mencatat kajian.
 *
 * Catatan halaman: tabel `ayat` tidak punya nomor halaman mushaf maupun juz,
 * jadi tidak ada "buka halaman 255". Penggantinya gulir menerus per surah.
 */

export interface QuranPageProps {
  route: Route
  navigate: (patch: Partial<Route>, replace?: boolean) => void
}

interface Toast {
  text: string
  documentId: string
  blockId: string
}

export function QuranPage({ route, navigate }: QuranPageProps): JSX.Element {
  const surahNumber = route.surah
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [notesFor, setNotesFor] = useState<Ayat | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [hintDismissed, setHintDismissed] = useState(true)
  const [resume, setResume] = useState<{ surah: number; number: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const scrolledTo = useRef<string | null>(null)

  // ── data ────────────────────────────────────────────────────────────────────

  const ayatList = useLiveQuery(
    async () => {
      if (!surahNumber) return [] as Ayat[]
      const rows = await db.ayat.where('surah').equals(surahNumber).toArray()
      return rows.sort((a, b) => a.number - b.number)
    },
    [surahNumber],
    [] as Ayat[],
  )

  const meta = useLiveQuery(
    async () => (surahNumber ? db.surahs.get(surahNumber) : undefined),
    [surahNumber],
  )

  /**
   * Berapa blok catatan yang menunjuk tiap ayat di surah ini.
   * Murni lookup indeks `[ayat_surah+ayat_number]` yang sudah ada — inilah yang
   * membuat pembaca jadi indeks dua arah, bukan sekadar layar baca.
   */
  const noteCounts = useLiveQuery(
    async () => {
      const counts = new Map<string, number>()
      if (!surahNumber) return counts
      const blocks = await db.blocks
        .where('[ayat_surah+ayat_number]')
        .between([surahNumber, 0], [surahNumber, Infinity])
        .toArray()
      for (const block of blocks) {
        if (block.deleted_at || block.ayat_number === null) continue
        const key = AYAT_KEY(surahNumber, block.ayat_number)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return counts
    },
    [surahNumber],
    new Map<string, number>(),
  )

  const notesForAyat = useLiveQuery(
    async () => {
      if (!notesFor) return [] as Block[]
      const blocks = await db.blocks
        .where('[ayat_surah+ayat_number]')
        .equals([notesFor.surah, notesFor.number])
        .toArray()
      return blocks.filter((b) => !b.deleted_at)
    },
    [notesFor?.surah, notesFor?.number],
    [] as Block[],
  )

  // ── memuat & menyimpan preferensi ───────────────────────────────────────────

  useEffect(() => {
    void getMeta<string | null>(META.lastRead, null).then((value) => {
      setResume(value ? parseAyatKey(value) : null)
    })
    void getMeta<boolean>(META.readerHintDismissed, false).then((v) => setHintDismissed(v))
    void getMeta<string | null>(META.lastNoteTarget, null).then(async (value) => {
      setTargetId(value ?? (await getMeta<string | null>(META.lastDocumentId, null)))
    })
  }, [])

  // ── virtualisasi ────────────────────────────────────────────────────────────

  const virtualizer = useVirtualizer({
    count: ayatList.length,
    getScrollElement: () => scrollRef.current,
    // Tinggi baris sangat bervariasi (ayat 2:282 jauh lebih panjang dari 108:1),
    // jadi perkiraan ini hanya untuk scroll awal; sisanya diukur nyata.
    estimateSize: () => 190,
    overscan: 6,
    getItemKey: (index) => ayatList[index]?.number ?? index,
  })

  // Gulir ke ayat yang diminta lewat URL, sekali saja per (surah, ayat).
  useEffect(() => {
    if (!surahNumber || !route.ayat || ayatList.length === 0) return
    const token = `${surahNumber}:${route.ayat}`
    if (scrolledTo.current === token) return
    const index = ayatList.findIndex((a) => a.number === route.ayat)
    if (index === -1) return
    scrolledTo.current = token
    virtualizer.scrollToIndex(index, { align: 'start' })
  }, [surahNumber, route.ayat, ayatList, virtualizer])

  // Simpan posisi baca: ayat teratas yang sedang tampak.
  useEffect(() => {
    if (!surahNumber || ayatList.length === 0) return
    const items = virtualizer.getVirtualItems()
    const first = items[0]
    if (!first) return
    const ayat = ayatList[first.index]
    if (!ayat) return
    void setMeta(META.lastRead, AYAT_KEY(ayat.surah, ayat.number))
  }, [surahNumber, ayatList, virtualizer.getVirtualItems()])

  // ── pilihan ─────────────────────────────────────────────────────────────────

  const handleToggle = useCallback((key: string): void => {
    setSelected((previous) => toggleAyat(previous, key))
    setAnchor(key)
  }, [])

  const handleExtend = useCallback(
    (key: string): void => {
      setSelected((previous) => extendRange(previous, anchor ?? key, key))
      if (!anchor) setAnchor(key)
    },
    [anchor],
  )

  const clearSelection = useCallback((): void => {
    setSelected(new Set())
    setAnchor(null)
  }, [])

  const refs = useMemo(() => selectionToRefs(selected), [selected])

  const handleSave = useCallback(
    async (documentId: string, annotation: string): Promise<void> => {
      const created = await appendAyatNote(documentId, refs, annotation)
      await setMeta(META.lastNoteTarget, documentId)
      setTargetId(documentId)
      setSheetOpen(false)
      clearSelection()
      if (created) {
        const document = await db.documents.get(documentId)
        setToast({
          text: `Tersimpan ke "${document?.title ?? 'catatan'}"`,
          documentId,
          blockId: created,
        })
        window.setTimeout(() => setToast(null), 6000)
      }
    },
    [refs, clearSelection],
  )

  const openSurah = useCallback(
    (surah: number, ayat?: number): void => {
      clearSelection()
      scrolledTo.current = null
      navigate({ view: 'quran', surah, ayat: ayat ?? null })
    },
    [navigate, clearSelection],
  )

  // ── render ──────────────────────────────────────────────────────────────────

  if (!surahNumber) {
    return <SurahIndex onOpenSurah={openSurah} resume={resume} />
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-ink-faint/15 px-2 py-2">
        <button
          type="button"
          onClick={() => navigate({ view: 'quran', surah: null, ayat: null })}
          className="tap-target shrink-0 px-1 text-[15px] text-accent"
          aria-label="Kembali ke daftar surah"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold">
            {meta?.name_latin ?? `Surah ${surahNumber}`}
          </h1>
          <p className="truncate text-[12px] text-ink-faint">
            {meta?.name_id} · {meta?.ayah_count} ayat
          </p>
        </div>
        <span dir="rtl" lang="ar" className="shrink-0 font-quran text-[20px]">
          {meta?.name_arabic}
        </span>
      </header>

      {!hintDismissed && (
        <button
          type="button"
          onClick={() => {
            setHintDismissed(true)
            void setMeta(META.readerHintDismissed, true)
          }}
          className="shrink-0 border-b border-accent/20 bg-accent-soft/40 px-3 py-1.5 text-left text-[12px] text-accent-ink"
        >
          Ketuk ayat untuk memilih · tahan untuk memilih rentang — <u>mengerti</u>
        </button>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const ayat = ayatList[item.index]
            if (!ayat) return null
            const key = AYAT_KEY(ayat.surah, ayat.number)
            return (
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
                <AyahRow
                  ayat={ayat}
                  selected={selected.has(key)}
                  noteCount={noteCounts.get(key) ?? 0}
                  onToggle={handleToggle}
                  onExtend={handleExtend}
                  onOpenNotes={setNotesFor}
                />
              </div>
            )
          })}
        </div>
      </div>

      {toast && (
        <div className="shrink-0 border-t border-accent/20 bg-accent-soft/60 px-3 py-2 text-[13px] text-accent-ink">
          {toast.text}{' '}
          <button
            type="button"
            onClick={() =>
              navigate({
                view: 'outline',
                documentId: toast.documentId,
                zoom: null,
                focus: toast.blockId,
              })
            }
            className="font-semibold underline underline-offset-2"
          >
            Buka
          </button>
        </div>
      )}

      {/* Bilah aksi ikut aliran flex — bilah melayang menutupi navigasi bawah (D16). */}
      {selected.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-ink-faint/20 bg-paper-card px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
            {formatSelection(refs)}
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg bg-paper-sunk px-3 py-2.5 text-[14px]"
          >
            Bersihkan
          </button>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="rounded-lg bg-accent px-4 py-2.5 text-[14px] font-medium text-white"
          >
            Catat
          </button>
        </div>
      )}

      <NoteSheet
        open={sheetOpen}
        refs={refs}
        targetId={targetId}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        onTargetChange={setTargetId}
      />

      {notesFor && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/30" onClick={() => setNotesFor(null)}>
          <div
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-paper-card pb-[env(safe-area-inset-bottom)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto my-2 h-1 w-10 rounded-full bg-ink-faint/40" />
            <h2 className="px-4 pb-2 text-[13px] font-semibold text-accent">
              Catatan pada QS {notesFor.surah}:{notesFor.number}
            </h2>
            {notesForAyat.map((block) => (
              <button
                key={block.id}
                type="button"
                onClick={() => {
                  setNotesFor(null)
                  navigate({
                    view: 'outline',
                    documentId: block.document_id,
                    zoom: null,
                    focus: block.id,
                  })
                }}
                className="block w-full border-t border-ink-faint/10 px-4 py-3 text-left"
              >
                <span className="block text-[15px]">
                  {blockTitle(block) || '(tanpa anotasi)'}
                </span>
                <span className="block text-[12px] text-ink-faint">buka di outline ›</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
