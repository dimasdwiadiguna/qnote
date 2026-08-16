import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { formatReference } from '../lib/ayatSearch'
import { ContentView } from '../features/outliner/ContentView'
import type { BlockHit } from '../lib/search'

/** Ringkasan satu blok untuk layar Cari, Kandidat, dan Inspirasi. */
export function BlockPreview({
  hit,
  onOpen,
  action,
}: {
  hit: BlockHit
  onOpen: () => void
  action?: React.ReactNode
}): JSX.Element {
  const { block } = hit
  const ayat = useLiveQuery(async () => {
    if (block.block_type !== 'ayat') return undefined
    if (block.ayat_surah === null || block.ayat_number === null) return undefined
    return db.ayat.get([block.ayat_surah, block.ayat_number])
  }, [block.id, block.ayat_surah, block.ayat_number])

  return (
    <article className="border-b border-ink-faint/12 px-4 py-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-faint">
        <span className="truncate">{hit.documentTitle}</span>
        {block.is_promoted === 1 && <span className="text-accent">★ blok</span>}
        {block.block_type === 'ayat' && block.ayat_surah !== null && (
          <span className="text-accent">
            {formatReference(block.ayat_surah, block.ayat_number ?? 0)}
          </span>
        )}
      </div>

      <button type="button" onClick={onOpen} className="block w-full text-left">
        {ayat && (
          <>
            <p dir="rtl" lang="ar" className="arabic text-right text-[1.3rem] leading-[2]">
              {ayat.arabic}
            </p>
            <p dir="ltr" lang="id" className="mt-1 text-[14px] text-ink-soft">
              {ayat.translation_id}
            </p>
          </>
        )}
        {(block.content.trim().length > 0 || !ayat) && (
          <div className="mt-1">
            <ContentView
              content={block.content}
              categories={hit.categories}
              placeholder="(kosong)"
            />
          </div>
        )}
      </button>

      {action && <div className="mt-2">{action}</div>}
    </article>
  )
}
