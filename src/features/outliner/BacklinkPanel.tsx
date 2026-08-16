import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { blockTitle } from '../../db/indexing'
import { formatReference } from '../../lib/ayatSearch'
import type { Block } from '../../db/types'

/**
 * Panel backlink — salah satu dari tiga hal yang dibuka oleh promosi
 * (brief §2.4). Query-nya murni lookup indeks pada `block_links` karena tabel
 * itu dimaterialisasi saat tulis; tidak ada pemindaian teks di sini.
 */

export interface BacklinkPanelProps {
  blockId: string
  onOpen: (block: Block) => void
}

export function BacklinkPanel({ blockId, onOpen }: BacklinkPanelProps): JSX.Element | null {
  const sources = useLiveQuery(async () => {
    const links = await db.block_links.where('to_block_id').equals(blockId).toArray()
    const ids = links.filter((link) => !link.deleted_at).map((link) => link.from_block_id)
    if (ids.length === 0) return []
    const blocks = await db.blocks.bulkGet(ids)
    return blocks.filter((block): block is Block => Boolean(block) && !block?.deleted_at)
  }, [blockId])

  if (!sources || sources.length === 0) return null

  return (
    <section className="mt-4 rounded-lg border border-ink-faint/20 bg-paper-sunk/60 p-3">
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Backlink · {sources.length}
      </h2>
      <ul className="space-y-1.5">
        {sources.map((source) => (
          <li key={source.id}>
            <button
              type="button"
              onClick={() => onOpen(source)}
              className="w-full text-left text-[14px] leading-snug text-ink-soft active:text-ink"
            >
              {source.block_type === 'ayat' && source.ayat_surah !== null
                ? `${formatReference(source.ayat_surah, source.ayat_number ?? 0)} — ${blockTitle(source)}`
                : blockTitle(source) || 'Bullet kosong'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
