import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { squash } from '../../lib/normalize'
import { searchAyat, type AyatHit } from '../../lib/ayatSearch'
import { formatReference } from '../../lib/ayatSearch'
import type { SurahMeta } from '../../db/types'

/**
 * Pintu masuk layar Qur'an: daftar 114 surah + satu kolom yang sekaligus
 * menerima rujukan langsung (`2:153`) dan potongan terjemah.
 *
 * Pencocokan nama memakai ulang `squash()` — "al baqarah", "Al-Baqarah", dan
 * "albaqarah" harus sama-sama menemukan surah 2.
 */

export interface SurahIndexProps {
  onOpenSurah: (surah: number, ayat?: number) => void
  resume: { surah: number; number: number } | null
}

export function SurahIndex({ onOpenSurah, resume }: SurahIndexProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AyatHit[]>([])

  const surahs = useLiveQuery(
    async () => (await db.surahs.toArray()).sort((a, b) => a.surah - b.surah),
    [],
    [] as SurahMeta[],
  )

  const filtered = useMemo(() => {
    const needle = squash(query)
    if (needle.length === 0) return surahs
    return surahs.filter(
      (s) =>
        s.name_squashed.includes(needle) ||
        squash(s.name_id).includes(needle) ||
        String(s.surah) === query.trim(),
    )
  }, [surahs, query])

  // Rujukan / potongan terjemah dicari lewat jalur yang sudah ada.
  const runLookup = (value: string): void => {
    setQuery(value)
    if (value.trim().length < 2) {
      setHits([])
      return
    }
    void searchAyat(value, 8).then(setHits)
  }

  const resumeSurah = resume ? surahs.find((s) => s.surah === resume.surah) : undefined

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-ink-faint/15 px-3 py-2">
        <h1 className="text-[17px] font-semibold">Qur'an</h1>
        <input
          value={query}
          onChange={(event) => runLookup(event.target.value)}
          placeholder="Nama surah, 2:153, atau potongan terjemah"
          enterKeyHint="search"
          className="mt-2 w-full rounded-lg bg-paper-sunk px-3 py-2.5 text-[16px] outline-none"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {resumeSurah && query.trim().length === 0 && (
          <button
            type="button"
            onClick={() => onOpenSurah(resumeSurah.surah, resume?.number)}
            className="flex w-full items-center justify-between border-b border-ink-faint/12 bg-accent-soft/30 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-[12px] text-accent">Lanjutkan bacaan</span>
              <span className="block text-[16px] font-medium">
                {resumeSurah.name_latin} : {resume?.number}
              </span>
            </span>
            <span className="text-[18px] text-accent">›</span>
          </button>
        )}

        {hits.length > 0 && (
          <section className="border-b border-ink-faint/15">
            <h2 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Langsung ke ayat
            </h2>
            {hits.map((hit) => (
              <button
                key={`${hit.ayat.surah}:${hit.ayat.number}`}
                type="button"
                onClick={() => onOpenSurah(hit.ayat.surah, hit.ayat.number)}
                className="block w-full px-4 py-2.5 text-left active:bg-accent-soft/40"
              >
                <span className="block text-[12px] font-semibold text-accent">
                  {formatReference(hit.ayat.surah, hit.ayat.number)}
                </span>
                <span className="line-clamp-2 block text-[14px] text-ink-soft">
                  {hit.ayat.translation_id}
                </span>
              </button>
            ))}
          </section>
        )}

        {surahs.length === 0 && (
          <p className="px-4 py-8 text-center text-[14px] text-ink-faint">
            Data Quran belum diimpor. Buka Setelan → Data Quran.
          </p>
        )}

        {filtered.map((surah) => (
          <button
            key={surah.surah}
            type="button"
            onClick={() => onOpenSurah(surah.surah)}
            className="flex w-full items-center gap-3 border-b border-ink-faint/12 px-4 py-2.5 text-left active:bg-paper-sunk"
          >
            <span className="w-7 shrink-0 text-[13px] tabular-nums text-ink-faint">
              {surah.surah}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium">{surah.name_latin}</span>
              <span className="block truncate text-[12px] text-ink-faint">
                {surah.name_id} · {surah.ayah_count} ayat
              </span>
            </span>
            {/* Nama Arab di elemen sendiri — jangan pernah dicampur dengan Latin. */}
            <span dir="rtl" lang="ar" className="shrink-0 font-quran text-[19px]">
              {surah.name_arabic}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
