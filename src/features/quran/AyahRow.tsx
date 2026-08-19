import { memo, useRef } from 'react'
import type { Ayat } from '../../db/types'

/**
 * Satu ayat di layar pembaca.
 *
 * Lebih ramping daripada `AyatCard` milik outline: tanpa bingkai kartu, tanpa
 * tombol ciut, tanpa baris anotasi. Yang dipakai ulang adalah kelas `.arabic`
 * beserta aturan bidi — Arab dan Latin TIDAK PERNAH dalam satu node teks.
 */

const LONG_PRESS_MS = 400

export interface AyahRowProps {
  ayat: Ayat
  selected: boolean
  /** Jumlah blok catatan yang sudah menunjuk ayat ini. */
  noteCount: number
  onToggle: (key: string) => void
  onExtend: (key: string) => void
  onOpenNotes: (ayat: Ayat) => void
}

export const AyahRow = memo(function AyahRow({
  ayat,
  selected,
  noteCount,
  onToggle,
  onExtend,
  onOpenNotes,
}: AyahRowProps) {
  const key = `${ayat.surah}:${ayat.number}`
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const start = (): void => {
    longPressed.current = false
    timer.current = window.setTimeout(() => {
      longPressed.current = true
      onExtend(key)
    }, LONG_PRESS_MS)
  }

  const end = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-ayah={key}
      onPointerDown={start}
      onPointerUp={() => {
        end()
        if (!longPressed.current) onToggle(key)
      }}
      onPointerLeave={end}
      onPointerCancel={end}
      onContextMenu={(event) => {
        event.preventDefault()
        onExtend(key)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle(key)
        }
      }}
      className={`cursor-pointer border-b border-ink-faint/12 py-3 pl-3 pr-3 transition-colors ${
        selected ? 'border-l-4 border-l-accent bg-accent-soft/40 pl-2' : 'border-l-4 border-l-transparent'
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums ${
            selected ? 'bg-accent text-white' : 'bg-paper-sunk text-ink-soft'
          }`}
        >
          {ayat.number}
        </span>

        {noteCount > 0 && (
          <button
            type="button"
            // Jangan biarkan ketukan lencana ikut memilih ayatnya.
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => {
              event.stopPropagation()
              onOpenNotes(ayat)
            }}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
          >
            {noteCount} catatan
          </button>
        )}
      </div>

      {/* Arab — elemennya sendiri. */}
      <p dir="rtl" lang="ar" className="arabic text-right text-ink">
        {ayat.arabic}
      </p>

      {/* Terjemah — elemennya sendiri. */}
      <p dir="ltr" lang="id" className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {ayat.translation_id}
      </p>
    </div>
  )
})
