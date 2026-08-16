import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { setPromoted } from '../../db/repo'
import { buildSearchIndex, candidateBlocks } from '../../lib/search'
import { BlockPreview } from '../../ui/BlockPreview'
import type { Route } from '../../ui/router'

/**
 * Layar "Kandidat" (brief §2.4): bullet yang punya tag, kategori langsung, atau
 * ayat — tapi BELUM dipromosikan. Ini daftar tinjau berkala.
 *
 * Perhatikan yang TIDAK terjadi di sini: tidak ada promosi otomatis. Tag dan
 * kategori tetap terindeks dan bisa difilter di semua bullet tanpa promosi;
 * promosi hanya membuka wiki-link, backlink, dan drill.
 */
export function CandidatesPage({
  navigate,
}: {
  navigate: (patch: Partial<Route>) => void
}): JSX.Element {
  const [filter, setFilter] = useState<'semua' | 'ayat' | 'tag'>('semua')
  const index = useLiveQuery(() => buildSearchIndex(), [])

  const candidates = useMemo(() => {
    if (!index) return []
    const all = candidateBlocks(index)
    if (filter === 'ayat') return all.filter((hit) => hit.block.block_type === 'ayat')
    if (filter === 'tag') return all.filter((hit) => hit.tags.length > 0)
    return all
  }, [index, filter])

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-ink-faint/15 px-3 py-2">
        <h1 className="text-[17px] font-semibold">Kandidat</h1>
        <p className="mt-0.5 text-[12px] text-ink-soft">
          Bullet bertanda yang belum dipromosikan jadi blok.
        </p>
        <div className="mt-2 flex gap-1.5 text-[12px]">
          {(['semua', 'ayat', 'tag'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full px-2.5 py-1 ${
                filter === value ? 'bg-accent text-white' : 'bg-paper-sunk text-ink-soft'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {!index && <p className="px-4 py-6 text-[14px] text-ink-faint">Memuat…</p>}
        {index && candidates.length === 0 && (
          <p className="px-4 py-8 text-center text-[14px] text-ink-faint">
            Tidak ada kandidat. Semua bullet bertanda sudah ditinjau.
          </p>
        )}
        {candidates.map((hit) => (
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
            action={
              <button
                type="button"
                onClick={() => void setPromoted(hit.block.id, true)}
                className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white"
              >
                ★ Jadikan blok
              </button>
            }
          />
        ))}
      </div>
    </div>
  )
}
