import { memo } from 'react'
import { segmentContent } from '../../lib/parser'
import type { CategoryAssignment } from '../../lib/inherit'

/**
 * Tampilan baca sebuah bullet.
 *
 * Dipakai HANYA di layar baca: hasil pencarian, Kandidat, Inspirasi, Drill.
 * Bullet yang bisa diedit memakai lapisan cermin di dalam BlockEditor, yang
 * chip-nya wajib bermetrik nol; di sini chip bebas berpadding karena tidak ada
 * kursor yang harus disejajarkan.
 *
 * Seluruh karakter `content` tetap dirender apa adanya — termasuk `#`, `[`, `]`
 * — supaya yang terlihat di layar baca sama dengan yang diketik.
 */

export interface ContentViewProps {
  content: string
  categories: CategoryAssignment
  placeholder?: string
  muted?: boolean
}

const CHIP_CLASS: Record<string, string> = {
  tag: 'chip chip-tag',
  category: 'chip chip-category',
  link: 'chip chip-link',
}

export const ContentView = memo(function ContentView({
  content,
  categories,
  placeholder = 'Tulis di sini…',
  muted = false,
}: ContentViewProps) {
  const segments = segmentContent(content)

  return (
    <div
      className={`whitespace-pre-wrap break-words text-[16px] leading-[1.65] ${
        muted ? 'text-ink-soft' : 'text-ink'
      }`}
    >
      {segments.length === 0 ? (
        <span className="text-ink-faint">{placeholder}</span>
      ) : (
        segments.map((segment, index) =>
          segment.type === 'text' ? (
            <span key={index}>{segment.text}</span>
          ) : (
            <span key={index} className={CHIP_CLASS[segment.token.kind]}>
              {content.slice(segment.token.start, segment.token.end)}
            </span>
          ),
        )
      )}
      {categories.inherited.length > 0 && (
        <span className="ml-1 align-middle">
          {categories.inherited.map((path) => (
            <span
              key={path}
              className="chip chip-inherited ml-1"
              title={`Kategori warisan dari leluhur: ${path}`}
            >
              {path}
            </span>
          ))}
        </span>
      )}
    </div>
  )
})
