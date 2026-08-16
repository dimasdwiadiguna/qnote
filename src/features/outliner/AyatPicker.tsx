import { useEffect, useRef, useState } from 'react'
import { searchAyat, type AyatHit } from '../../lib/ayatSearch'
import { formatReference } from '../../lib/ayatSearch'

/**
 * Palet sisip ayat (brief §5). Tiga bentuk query dikenali: `2:153`,
 * `al baqarah 153`, atau potongan terjemah. Dibuka lewat tombol `[+ ayat]`
 * atau mengetik `@`.
 */

export interface AyatPickerProps {
  open: boolean
  onClose: () => void
  onPick: (surah: number, number: number) => void
}

export function AyatPicker({ open, onClose, onPick }: AyatPickerProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AyatHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHits([])
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    if (query.trim().length === 0) {
      setHits([])
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchAyat(query).then((rows) => {
        if (!alive) return
        setHits(rows)
        setSearching(false)
      })
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex items-center gap-2 border-b border-ink-faint/20 px-3 py-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="2:153 · al baqarah 153 · potongan terjemah"
          className="min-w-0 flex-1 rounded-lg bg-paper-sunk px-3 py-2 text-[16px] outline-none"
          enterKeyHint="search"
        />
        <button
          type="button"
          onClick={onClose}
          className="tap-target rounded-lg px-3 text-[15px] text-ink-soft"
        >
          Batal
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {query.trim().length === 0 && (
          <p className="px-4 py-6 text-center text-[14px] text-ink-faint">
            Cari ayat lewat rujukan, nama surah, atau potongan terjemah.
          </p>
        )}
        {query.trim().length > 0 && hits.length === 0 && !searching && (
          <p className="px-4 py-6 text-center text-[14px] text-ink-faint">
            Tidak ada yang cocok. Kalau data Quran belum diimpor, buka Setelan.
          </p>
        )}
        {hits.map((hit) => (
          <button
            key={`${hit.ayat.surah}:${hit.ayat.number}`}
            type="button"
            onClick={() => onPick(hit.ayat.surah, hit.ayat.number)}
            className="block w-full border-b border-ink-faint/10 px-4 py-3 text-left active:bg-accent-soft/40"
          >
            <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-accent">
              <span>{formatReference(hit.ayat.surah, hit.ayat.number)}</span>
              {hit.surah && <span className="text-ink-faint">{hit.surah.name_latin}</span>}
            </div>
            <p dir="rtl" lang="ar" className="arabic text-right text-[1.35rem] leading-[2]">
              {hit.ayat.arabic}
            </p>
            <p dir="ltr" lang="id" className="mt-1 text-[14px] text-ink-soft">
              {hit.ayat.translation_id}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
