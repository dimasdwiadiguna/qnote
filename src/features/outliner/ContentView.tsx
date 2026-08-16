import { memo } from 'react'
import { segmentContent } from '../../lib/parser'
import type { CategoryAssignment } from '../../lib/inherit'

/**
 * Tampilan baca sebuah bullet.
 *
 * PENTING: seluruh karakter `content` dirender apa adanya — termasuk `#`, `[`,
 * `]`. Penanda hanya diberi warna, tidak disembunyikan. Alasannya bukan estetika
 * tapi mekanik: pemetaan titik-sentuh → posisi kursor (`offsetFromPoint`)
 * mengandalkan teks tampil identik dengan teks mentah. Menyembunyikan kurung
 * akan menggeser kursor tiap kali ada penanda di depannya.
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

/**
 * Memetakan titik sentuh ke offset karakter di dalam `content`.
 * Dipakai agar mengetuk di tengah kalimat menaruh kursor di sana — bukan di
 * akhir baris seperti kebanyakan outliner web.
 */
export function offsetFromPoint(container: HTMLElement, x: number, y: number): number | null {
  let node: Node | null = null
  let offset = 0

  const doc = container.ownerDocument
  type LegacyDocument = Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }
  const legacy = doc as LegacyDocument

  if (typeof legacy.caretRangeFromPoint === 'function') {
    const range = legacy.caretRangeFromPoint(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  } else if (typeof legacy.caretPositionFromPoint === 'function') {
    const position = legacy.caretPositionFromPoint(x, y)
    if (position) {
      node = position.offsetNode
      offset = position.offset
    }
  }

  if (!node || !container.contains(node)) return null

  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let total = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + offset
    total += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  return total
}
