import { memo } from 'react'
import type { Ayat, SurahMeta } from '../../db/types'

/**
 * Kartu ayat penuh: Arab + terjemah langsung terlihat, tanpa perlu tap.
 *
 * ATURAN BIDI (brief §5): teks Arab dan Latin TIDAK PERNAH berada dalam satu
 * node teks. Arab punya elemennya sendiri dengan `dir="rtl" lang="ar"`,
 * terjemah punya elemennya sendiri dengan `dir="ltr" lang="id"`. Mencampurnya
 * — misalnya `<p>{arab} ({surah}:{ayat})</p>` — akan membalik urutan tanda baca
 * dan angka secara acak.
 */

export interface AyatCardProps {
  ayat: Ayat | undefined
  surah: SurahMeta | undefined
  reference: string
  /** Ciut jadi chip ringkas — TIDAK menyembunyikan anak-anaknya. */
  collapsed: boolean
  onToggle: () => void
  /** Kata yang disembunyikan (mode cloze); kosong di editor. */
  hiddenWords?: ReadonlySet<number>
}

export const AyatCard = memo(function AyatCard({
  ayat,
  surah,
  reference,
  collapsed,
  onToggle,
  hiddenWords,
}: AyatCardProps) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft/60 px-2.5 py-1 text-[13px] font-medium text-accent-ink"
      >
        <span>{reference}</span>
        {surah && <span className="text-accent/70">· {surah.name_latin}</span>}
      </button>
    )
  }

  if (!ayat) {
    return (
      <div className="rounded-lg border border-dashed border-ink-faint/50 bg-paper-sunk px-3 py-2 text-[13px] text-ink-soft">
        {reference} — teks belum tersedia. Selesaikan impor data Quran di Setelan.
      </div>
    )
  }

  const words = ayat.arabic.split(/\s+/).filter(Boolean)

  return (
    <div className="rounded-lg border border-accent/15 bg-gradient-to-b from-accent-soft/30 to-paper-card px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="text-[12px] font-semibold uppercase tracking-wide text-accent"
        >
          {reference}
        </button>
        {surah && <span className="text-[12px] text-ink-faint">{surah.name_latin}</span>}
      </div>

      {/* Elemen Arab — terpisah total dari teks Latin mana pun. */}
      <p dir="rtl" lang="ar" className="arabic text-right text-ink">
        {hiddenWords
          ? words.map((word, index) => (
              <span key={index}>
                {hiddenWords.has(index) ? (
                  <span className="mx-0.5 inline-block min-w-[3ch] rounded bg-ink/10 align-middle text-transparent">
                    {' '.repeat(Math.max(3, word.length))}
                  </span>
                ) : (
                  word
                )}{' '}
              </span>
            ))
          : ayat.arabic}
      </p>

      {/* Elemen terjemah — LTR, bahasa Indonesia. */}
      <p dir="ltr" lang="id" className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {ayat.translation_id}
      </p>
    </div>
  )
})
