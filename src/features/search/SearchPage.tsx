import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { searchAyat, formatReference, type AyatHit } from '../../lib/ayatSearch'
import {
  buildSearchIndex,
  searchBlocks,
  EMPTY_FILTERS,
  type SearchFilters,
} from '../../lib/search'
import { BlockPreview } from '../../ui/BlockPreview'
import type { Route } from '../../ui/router'

/**
 * Pencarian full-text lintas semua bullet + ayat, dengan filter gabungan
 * `#tag` AND/OR `[kategori]`. Filter kategori otomatis menyertakan seluruh
 * turunannya dan — kecuali dimatikan — juga kategori WARISAN.
 */
export function SearchPage({
  navigate,
}: {
  navigate: (patch: Partial<Route>) => void
}): JSX.Element {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [ayatHits, setAyatHits] = useState<AyatHit[]>([])

  const index = useLiveQuery(
    () =>
      // Bergantung pada empat tabel; useLiveQuery melacaknya otomatis karena
      // buildSearchIndex membacanya di dalam observable transaction.
      buildSearchIndex(),
    [],
  )

  const results = useMemo(
    () => (index ? searchBlocks(index, filters) : []),
    [index, filters],
  )

  useEffect(() => {
    let alive = true
    if (filters.query.trim().length < 2) {
      setAyatHits([])
      return
    }
    const timer = window.setTimeout(() => {
      void searchAyat(filters.query, 20).then((rows) => {
        if (alive) setAyatHits(rows)
      })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [filters.query])

  const toggle = (kind: 'tags' | 'categories', value: string): void => {
    setFilters((previous) => {
      const list = previous[kind]
      return {
        ...previous,
        [kind]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      }
    })
  }

  const tagCount = useLiveQuery(() => db.tags.count(), [], 0)

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-2 border-b border-ink-faint/15 px-3 py-2">
        <input
          value={filters.query}
          onChange={(event) =>
            setFilters((previous) => ({ ...previous, query: event.target.value }))
          }
          placeholder="Cari catatan & ayat…"
          className="w-full rounded-lg bg-paper-sunk px-3 py-2 text-[16px] outline-none"
          enterKeyHint="search"
        />

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto text-[12px]">
          <button
            type="button"
            onClick={() =>
              setFilters((previous) => ({
                ...previous,
                mode: previous.mode === 'AND' ? 'OR' : 'AND',
              }))
            }
            className="shrink-0 rounded-full border border-accent/40 px-2.5 py-1 font-semibold text-accent"
          >
            {filters.mode}
          </button>
          <Toggle
            label="warisan"
            active={filters.includeInherited}
            onPress={() =>
              setFilters((p) => ({ ...p, includeInherited: !p.includeInherited }))
            }
          />
          <Toggle
            label="★ blok"
            active={filters.promotedOnly}
            onPress={() => setFilters((p) => ({ ...p, promotedOnly: !p.promotedOnly }))}
          />
          <Toggle
            label="ayat"
            active={filters.ayatOnly}
            onPress={() => setFilters((p) => ({ ...p, ayatOnly: !p.ayatOnly }))}
          />
          <Toggle
            label="kandidat"
            active={filters.candidatesOnly}
            onPress={() =>
              setFilters((p) => ({ ...p, candidatesOnly: !p.candidatesOnly }))
            }
          />
        </div>

        {index && index.allCategories.length > 0 && (
          <ChipRow
            items={index.allCategories}
            selected={filters.categories}
            prefix="["
            suffix="]"
            onToggle={(value) => toggle('categories', value)}
          />
        )}
        {index && index.allTags.length > 0 && (
          <ChipRow
            items={index.allTags}
            selected={filters.tags}
            prefix="#"
            onToggle={(value) => toggle('tags', value)}
          />
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {!index && <p className="px-4 py-6 text-[14px] text-ink-faint">Menyiapkan indeks…</p>}

        {index && (
          <p className="px-4 py-2 text-[12px] text-ink-faint">
            {results.length} bullet
            {ayatHits.length > 0 && ` · ${ayatHits.length} ayat`}
            {tagCount > 0 && ` · ${tagCount} tag`}
          </p>
        )}

        {results.map((hit) => (
          <BlockPreview
            key={hit.block.id}
            hit={hit}
            onOpen={() =>
              navigate({
                view: 'outline',
                documentId: hit.block.document_id,
                zoom: null,
                focus: hit.block.id,
              })
            }
          />
        ))}

        {ayatHits.length > 0 && (
          <>
            <h2 className="px-4 pb-1 pt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              Ayat
            </h2>
            {ayatHits.map((hit) => (
              <div key={`${hit.ayat.surah}:${hit.ayat.number}`} className="border-b border-ink-faint/12 px-4 py-3">
                <div className="mb-1 text-[11px] font-semibold text-accent">
                  {formatReference(hit.ayat.surah, hit.ayat.number)}
                  {hit.surah && <span className="ml-2 text-ink-faint">{hit.surah.name_latin}</span>}
                </div>
                <p dir="rtl" lang="ar" className="arabic text-right text-[1.3rem] leading-[2]">
                  {hit.ayat.arabic}
                </p>
                <p dir="ltr" lang="id" className="mt-1 text-[14px] text-ink-soft">
                  {hit.ayat.translation_id}
                </p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function Toggle({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`shrink-0 rounded-full px-2.5 py-1 ${
        active ? 'bg-accent text-white' : 'bg-paper-sunk text-ink-soft'
      }`}
    >
      {label}
    </button>
  )
}

function ChipRow({
  items,
  selected,
  prefix,
  suffix = '',
  onToggle,
}: {
  items: string[]
  selected: string[]
  prefix: string
  suffix?: string
  onToggle: (value: string) => void
}): JSX.Element {
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5 text-[12px]">
      {items.slice(0, 40).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onToggle(item)}
          className={`shrink-0 rounded-full px-2.5 py-1 ${
            selected.includes(item)
              ? 'bg-accent text-white'
              : 'bg-paper-sunk text-ink-soft'
          }`}
        >
          {prefix}
          {item}
          {suffix}
        </button>
      ))}
    </div>
  )
}
