import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { formatReference } from '../../lib/ayatSearch'
import { buildSearchIndex, searchBlocks, EMPTY_FILTERS } from '../../lib/search'
import { ContentView } from '../outliner/ContentView'
import type { Route } from '../../ui/router'
import type { Ayat } from '../../db/types'

/**
 * Mode "Inspirasi Dakwah" (brief §6): jelajah per kategori/tag, kartu besar
 * satu per satu, bisa di-swipe, dirancang untuk dipakai SATU TANGAN saat sedang
 * mengobrol. Karena itu: tidak ada daftar panjang, tidak ada tap kecil —
 * satu kartu memenuhi layar, geser kiri/kanan untuk pindah.
 */
export function InspirasiPage({
  navigate,
}: {
  navigate: (patch: Partial<Route>) => void
}): JSX.Element {
  const [tag, setTag] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const index = useLiveQuery(() => buildSearchIndex(), [])

  const cards = useMemo(() => {
    if (!index) return []
    const hits = searchBlocks(
      index,
      {
        ...EMPTY_FILTERS,
        tags: tag ? [tag] : [],
        categories: category ? [category] : [],
        mode: 'OR',
      },
      500,
    )
    // Bullet kosong tidak layak jadi kartu inspirasi.
    return hits.filter(
      (hit) => hit.block.content.trim().length > 0 || hit.block.block_type === 'ayat',
    )
  }, [index, tag, category])

  useEffect(() => {
    setPosition(0)
  }, [tag, category])

  const card = cards[position]

  const ayat = useLiveQuery<Ayat | undefined>(async () => {
    if (!card || card.block.block_type !== 'ayat') return undefined
    const { ayat_surah, ayat_number } = card.block
    if (ayat_surah === null || ayat_number === null) return undefined
    return db.ayat.get([ayat_surah, ayat_number])
  }, [card?.block.id])

  const step = (delta: number): void => {
    setPosition((previous) => {
      const next = previous + delta
      if (next < 0) return cards.length - 1
      if (next >= cards.length) return 0
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-ink-faint/15 px-3 py-2">
        <h1 className="text-[17px] font-semibold">Inspirasi Dakwah</h1>
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto text-[12px]">
          <button
            type="button"
            onClick={() => {
              setTag(null)
              setCategory(null)
            }}
            className={`shrink-0 rounded-full px-2.5 py-1 ${
              !tag && !category ? 'bg-ink text-paper' : 'bg-paper-sunk text-ink-soft'
            }`}
          >
            semua
          </button>
          {(index?.allCategories ?? []).slice(0, 20).map((path) => (
            <button
              key={`c-${path}`}
              type="button"
              onClick={() => {
                setCategory(category === path ? null : path)
                setTag(null)
              }}
              className={`shrink-0 rounded-full px-2.5 py-1 ${
                category === path ? 'bg-accent text-white' : 'bg-paper-sunk text-ink-soft'
              }`}
            >
              [{path}]
            </button>
          ))}
          {(index?.allTags ?? []).slice(0, 20).map((name) => (
            <button
              key={`t-${name}`}
              type="button"
              onClick={() => {
                setTag(tag === name ? null : name)
                setCategory(null)
              }}
              className={`shrink-0 rounded-full px-2.5 py-1 ${
                tag === name ? 'bg-amber-500 text-white' : 'bg-paper-sunk text-ink-soft'
              }`}
            >
              #{name}
            </button>
          ))}
        </div>
      </header>

      <div
        className="min-h-0 flex-1 select-none px-4 pb-28 pt-4"
        onTouchStart={(event) => {
          const touch = event.touches[0]
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY }
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current
          const touch = event.changedTouches[0]
          touchStart.current = null
          if (!start || !touch) return
          const dx = touch.clientX - start.x
          const dy = touch.clientY - start.y
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
        }}
      >
        {!card ? (
          <p className="mt-16 text-center text-[15px] text-ink-soft">
            Belum ada catatan untuk tema ini.
          </p>
        ) : (
          <article className="flex h-full flex-col rounded-2xl border border-ink-faint/20 bg-paper-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between text-[11px] text-ink-faint">
              <span>{card.documentTitle}</span>
              <span>
                {position + 1} / {cards.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {ayat && (
                <>
                  <p className="mb-2 text-[12px] font-semibold text-accent">
                    {formatReference(ayat.surah, ayat.number)}
                  </p>
                  <p dir="rtl" lang="ar" className="arabic text-right">
                    {ayat.arabic}
                  </p>
                  <p dir="ltr" lang="id" className="mt-3 text-[16px] leading-relaxed text-ink-soft">
                    {ayat.translation_id}
                  </p>
                </>
              )}
              {card.block.content.trim().length > 0 && (
                <div className={`text-[18px] leading-relaxed ${ayat ? 'mt-4' : ''}`}>
                  <ContentView content={card.block.content} categories={card.categories} />
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                className="tap-target flex-1 rounded-lg bg-paper-sunk text-[15px]"
              >
                ‹ sebelum
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate({
                    view: 'outline',
                    documentId: card.block.document_id,
                    zoom: null,
                    focus: card.block.id,
                  })
                }
                className="tap-target rounded-lg px-3 text-[13px] text-accent"
              >
                buka
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                className="tap-target flex-1 rounded-lg bg-accent text-[15px] text-white"
              >
                lanjut ›
              </button>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
