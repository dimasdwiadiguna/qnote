import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Grade } from 'ts-fsrs'

import { db } from '../../db/db'
import { gradeCard, getOrCreateReviewState, GRADES, clozeHiddenIndices, clozeRatio, previewIntervals } from '../../db/review'
import { parseAyatKey, type Ayat, type DrillMode } from '../../db/types'
import {
  buildQueue,
  loadLinkGraph,
  relatedAyat,
  summarize,
  type LinkGraph,
  type QueueCard,
} from '../../lib/drillQueue'
import { buildSearchIndex, type SearchIndex } from '../../lib/search'
import { blockTitle } from '../../db/indexing'
import { formatReference } from '../../lib/ayatSearch'
import { AyatCard } from '../outliner/AyatCard'
import type { Route } from '../../ui/router'

/**
 * Drill FSRS tiga mode (brief §7). Penilaian MURNI self-rating —
 * tidak ada evaluasi AI, tidak ada rekaman audio, tidak ada penilaian otomatis.
 */

const MODE_LABEL: Record<DrillMode, string> = {
  A: 'Tema → Ayat',
  B: 'Cloze Arab',
  C: 'Terjemah → Rujukan',
}

export function DrillPage({
  navigate,
}: {
  navigate: (patch: Partial<Route>) => void
}): JSX.Element {
  const [modes, setModes] = useState<DrillMode[]>(['A', 'B', 'C'])
  const [category, setCategory] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueCard[]>([])
  const [position, setPosition] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [graded, setGraded] = useState(0)

  const index = useLiveQuery(() => buildSearchIndex(), [])
  const links = useLiveQuery(() => loadLinkGraph(), [])

  const rebuild = useCallback(async (): Promise<void> => {
    if (!index || !links) return
    setLoading(true)
    const cards = await buildQueue(index, links, { modes, category, limit: 60 })
    setQueue(cards)
    setPosition(0)
    setRevealed(false)
    setLoading(false)
  }, [index, links, modes, category])

  useEffect(() => {
    void rebuild()
  }, [rebuild])

  const card = queue[position]
  const summary = useMemo(() => summarize(queue), [queue])

  const handleGrade = useCallback(
    async (grade: Grade): Promise<void> => {
      if (!card) return
      const state =
        card.state ??
        (await getOrCreateReviewState(card.mode, card.target_type, card.target_id))
      await gradeCard(state, grade)
      setGraded((n) => n + 1)
      setRevealed(false)
      setPosition((p) => p + 1)
    },
    [card],
  )

  const categories = index?.allCategories ?? []

  if (loading && queue.length === 0) {
    return <Centered>Menyiapkan antrian…</Centered>
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-ink-faint/15 px-3 py-2">
        <div className="flex items-center justify-between">
          <h1 className="text-[17px] font-semibold">Drill</h1>
          <span className="text-[12px] text-ink-faint">
            {Math.min(position + 1, queue.length)}/{queue.length} · selesai {graded}
          </span>
        </div>

        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto text-[12px]">
          {(['A', 'B', 'C'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() =>
                setModes((previous) =>
                  previous.includes(mode)
                    ? previous.filter((m) => m !== mode)
                    : [...previous, mode],
                )
              }
              className={`shrink-0 rounded-full px-2.5 py-1 ${
                modes.includes(mode) ? 'bg-accent text-white' : 'bg-paper-sunk text-ink-soft'
              }`}
            >
              {mode}. {MODE_LABEL[mode]} ({summary.byMode[mode]})
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <div className="no-scrollbar mt-1.5 flex gap-1.5 overflow-x-auto text-[12px]">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={`shrink-0 rounded-full px-2.5 py-1 ${
                category === null ? 'bg-ink text-paper' : 'bg-paper-sunk text-ink-soft'
              }`}
            >
              semua
            </button>
            {categories.slice(0, 30).map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => setCategory(path)}
                className={`shrink-0 rounded-full px-2.5 py-1 ${
                  category === path ? 'bg-accent text-white' : 'bg-paper-sunk text-ink-soft'
                }`}
              >
                [{path}]
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
        {!card && queue.length === 0 && (
          <Centered>
            Tidak ada kartu jatuh tempo.
            <span className="mt-2 block text-[13px]">
              Mode A butuh blok yang <strong>dipromosikan</strong> dan punya ayat terkait
              (parent–anak langsung atau wiki-link). Mode B & C butuh minimal satu kartu ayat
              di catatan.
            </span>
          </Centered>
        )}

        {!card && queue.length > 0 && (
          <Centered>
            Selesai — {graded} kartu dinilai.
            <button
              type="button"
              onClick={() => void rebuild()}
              className="mt-3 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-white"
            >
              Muat ulang antrian
            </button>
          </Centered>
        )}

        {card && (
          <DrillCard
            card={card}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onOpenBlock={(documentId, blockId) =>
              navigate({ view: 'outline', documentId, zoom: null, focus: blockId })
            }
            index={index}
            links={links}
          />
        )}
      </div>

      {/* Bilah penilaian ikut aliran flex, BUKAN `position: fixed` — di layar
          ini tidak ada keyboard yang perlu dihindari, dan bilah melayang akan
          menutupi navigasi bawah. */}
      {card && revealed && (
        <div className="shrink-0 border-t border-ink-faint/20 bg-paper-card px-2 py-2">
          <div className="grid grid-cols-4 gap-1.5">
            {GRADES.map(({ grade, label, hint }) => (
              <button
                key={grade}
                type="button"
                onClick={() => void handleGrade(grade)}
                className="rounded-lg bg-paper-sunk px-1 py-2.5 text-center active:bg-accent-soft"
              >
                <span className="block text-[14px] font-semibold">{label}</span>
                <span className="block text-[10px] text-ink-faint">
                  {card.state ? (previewIntervals(card.state)[grade] ?? hint) : hint}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {card && !revealed && (
        <div className="shrink-0 border-t border-ink-faint/20 bg-paper-card px-3 py-2">
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="w-full rounded-lg bg-accent px-4 py-3 text-[15px] font-medium text-white"
          >
            Buka jawaban
          </button>
        </div>
      )}
    </div>
  )
}

function DrillCard({
  card,
  revealed,
  onReveal,
  onOpenBlock,
  index,
  links,
}: {
  card: QueueCard
  revealed: boolean
  onReveal: () => void
  onOpenBlock: (documentId: string, blockId: string) => void
  index: SearchIndex | undefined
  links: LinkGraph | undefined
}): JSX.Element {
  const ayatRef = card.target_type === 'ayat' ? parseAyatKey(card.target_id) : null

  const ayat = useLiveQuery(async () => {
    if (!ayatRef) return undefined
    return db.ayat.get([ayatRef.surah, ayatRef.number])
  }, [card.target_id])

  const surah = useLiveQuery(async () => {
    if (!ayatRef) return undefined
    return db.surahs.get(ayatRef.surah)
  }, [card.target_id])

  const block = card.target_type === 'block' ? index?.byId.get(card.target_id) : undefined
  const related =
    card.mode === 'A' && index && links ? relatedAyat(index, links, card.target_id) : []

  const relatedAyatRows = useLiveQuery<(Ayat | undefined)[], (Ayat | undefined)[]>(
    async () => {
      if (related.length === 0) return []
      return db.ayat.bulkGet(related.map((ref) => [ref.surah, ref.number] as [number, number]))
    },
    [card.target_id, related.length],
    [],
  )

  const ratio = card.state ? clozeRatio(card.state) : 0.2
  const wordCount = ayat ? ayat.arabic.split(/\s+/).filter(Boolean).length : 0
  const hidden = useMemo(
    () =>
      card.mode === 'B' && !revealed && wordCount > 0
        ? clozeHiddenIndices(card.target_id, wordCount, ratio)
        : undefined,
    [card.mode, card.target_id, revealed, wordCount, ratio],
  )

  return (
    <div onClick={revealed ? undefined : onReveal}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-accent">
        Mode {card.mode} · {MODE_LABEL[card.mode]}
        {card.state === null && <span className="ml-2 text-ink-faint">kartu baru</span>}
      </p>

      {/* ── Mode A: teks blok dipromosikan → recall ayat terkait ── */}
      {card.mode === 'A' && (
        <>
          <div className="rounded-lg border border-ink-faint/20 bg-paper-card p-4">
            <p className="text-[17px] leading-relaxed">
              {block ? blockTitle(block) : 'Blok tidak ditemukan'}
            </p>
            {block && (
              <button
                type="button"
                onClick={() => onOpenBlock(block.document_id, block.id)}
                className="mt-2 text-[12px] text-accent underline underline-offset-2"
              >
                buka di outline
              </button>
            )}
          </div>
          {!revealed && (
            <p className="mt-4 text-center text-[13px] text-ink-faint">
              Sebutkan ayat yang terkait, lalu buka jawaban.
            </p>
          )}
          {revealed && (
            <div className="mt-3 space-y-2">
              {relatedAyatRows.filter(Boolean).map((row) =>
                row ? (
                  <AyatCard
                    key={`${row.surah}:${row.number}`}
                    ayat={row}
                    surah={undefined}
                    reference={formatReference(row.surah, row.number)}
                    collapsed={false}
                    onToggle={() => undefined}
                  />
                ) : null,
              )}
            </div>
          )}
        </>
      )}

      {/* ── Mode B: cloze Arab bertahap ── */}
      {card.mode === 'B' && ayatRef && (
        <>
          <AyatCard
            ayat={ayat}
            surah={surah}
            reference={formatReference(ayatRef.surah, ayatRef.number)}
            collapsed={false}
            onToggle={() => undefined}
            hiddenWords={hidden}
          />
          {!revealed && (
            <p className="mt-4 text-center text-[13px] text-ink-faint">
              Lengkapi bagian yang tertutup ({Math.round(ratio * 100)}% disembunyikan).
            </p>
          )}
        </>
      )}

      {/* ── Mode C: terjemah → sebutkan surah:ayat ── */}
      {card.mode === 'C' && ayatRef && (
        <>
          <div className="rounded-lg border border-ink-faint/20 bg-paper-card p-4">
            <p dir="ltr" lang="id" className="text-[16px] leading-relaxed">
              {ayat?.translation_id ?? '—'}
            </p>
          </div>
          {!revealed ? (
            <p className="mt-4 text-center text-[13px] text-ink-faint">
              Sebutkan surah dan nomor ayatnya.
            </p>
          ) : (
            <div className="mt-3">
              <AyatCard
                ayat={ayat}
                surah={surah}
                reference={formatReference(ayatRef.surah, ayatRef.number)}
                collapsed={false}
                onToggle={() => undefined}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-[15px] text-ink-soft">
      {children}
    </div>
  )
}
