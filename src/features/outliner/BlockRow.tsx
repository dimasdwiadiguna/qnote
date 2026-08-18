import { memo, useRef } from 'react'
import type { Ayat, SurahMeta } from '../../db/types'
import type { CategoryAssignment } from '../../lib/inherit'
import type { FlatNode } from '../../lib/tree'
import { AyatCard } from './AyatCard'
import { BlockEditor, type BlockEditorHandle } from './BlockEditor'
import { formatReference } from '../../lib/ayatSearch'

/**
 * Satu baris outline. Blok `'ayat'` adalah warga kelas satu di sini: struktur
 * baris, indentasi, collapse, dan status blok identik dengan blok `'text'` —
 * yang berbeda hanya isi area kontennya (kartu + baris anotasi).
 *
 * Baris ini SELALU memasang textarea, bahkan saat tidak difokus (lihat
 * BlockEditor). Itu yang membuat pindah bullet di HP tidak menurunkan keyboard.
 */

const INDENT_PX = 15
const LONG_PRESS_MS = 450

export interface BlockRowProps {
  node: FlatNode
  categories: CategoryAssignment
  ayat: Ayat | undefined
  surah: SurahMeta | undefined
  ayatCardCollapsed: boolean
  onZoom: (blockId: string) => void
  onToggleCollapse: (blockId: string) => void
  onToggleAyatCard: (blockId: string) => void
  onOpenMenu: (blockId: string) => void
  onInput: (blockId: string, value: string, caret: number) => void
  onKeyDown: (blockId: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: (blockId: string) => void
  onBlur: (blockId: string) => void
  onCaretMove: (blockId: string, caret: number) => void
  register: (blockId: string, handle: BlockEditorHandle | null) => void
  children?: React.ReactNode
}

export const BlockRow = memo(function BlockRow({
  node,
  categories,
  ayat,
  surah,
  ayatCardCollapsed,
  onZoom,
  onToggleCollapse,
  onToggleAyatCard,
  onOpenMenu,
  onInput,
  onKeyDown,
  onFocus,
  onBlur,
  onCaretMove,
  register,
  children,
}: BlockRowProps) {
  const { block, depth, hasChildren, hiddenCount } = node
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const isAyat = block.block_type === 'ayat'
  const reference =
    isAyat && block.ayat_surah !== null && block.ayat_number !== null
      ? formatReference(block.ayat_surah, block.ayat_number)
      : ''

  const startPress = (): void => {
    longPressed.current = false
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      onOpenMenu(block.id)
    }, LONG_PRESS_MS)
  }

  const endPress = (): void => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  return (
    <div
      className="relative"
      style={{ paddingLeft: depth * INDENT_PX }}
      data-block-id={block.id}
    >
      <div className="flex items-start gap-0.5">
        {/* Panah collapse — terpisah dari bullet supaya keduanya bisa disentuh
            dengan jempol tanpa saling menyerempet. */}
        <button
          type="button"
          aria-label={block.is_collapsed ? 'Buka' : 'Ciutkan'}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => hasChildren && onToggleCollapse(block.id)}
          className={`mt-px h-6 w-4 shrink-0 text-[11px] leading-6 text-ink-faint ${
            hasChildren ? 'visible' : 'invisible'
          }`}
        >
          {block.is_collapsed ? '▸' : '▾'}
        </button>

        {/* Bullet: tap = zoom-in, tahan = menu. `preventDefault` menjaga fokus
            tetap di textarea yang sedang aktif supaya keyboard tidak turun. */}
        <button
          type="button"
          aria-label="Zoom ke bullet ini"
          onPointerDown={(event) => {
            event.preventDefault()
            startPress()
          }}
          onPointerUp={() => {
            endPress()
            if (!longPressed.current) onZoom(block.id)
          }}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onContextMenu={(event) => {
            event.preventDefault()
            onOpenMenu(block.id)
          }}
          className="mt-[5px] h-4 w-4 shrink-0"
        >
          <span
            className={`mx-auto block rounded-full ${
              block.is_promoted
                ? 'h-2.5 w-2.5 bg-accent ring-2 ring-accent/25'
                : 'h-1.5 w-1.5 bg-ink-faint'
            } ${block.is_collapsed && hasChildren ? 'ring-4 ring-ink-faint/20' : ''}`}
          />
        </button>

        <div className="relative min-w-0 flex-1">
          {isAyat && (
            <div className="mb-1">
              <AyatCard
                ayat={ayat}
                surah={surah}
                reference={reference}
                collapsed={ayatCardCollapsed}
                onToggle={() => onToggleAyatCard(block.id)}
              />
            </div>
          )}

          <BlockEditor
            blockId={block.id}
            value={block.content}
            placeholder={isAyat ? 'Anotasi…' : ''}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            onBlur={onBlur}
            onCaretMove={onCaretMove}
            register={register}
          />

          {/* Kategori warisan hidup DI LUAR cermin editor: chip berpadding di
              dalam cermin akan menggeser metrik teks dan melencengkan kursor. */}
          {categories.inherited.length > 0 && (
            <div className="-mt-0.5 flex flex-wrap gap-1">
              {categories.inherited.map((path) => (
                <span
                  key={path}
                  className="chip chip-inherited"
                  title={`Kategori warisan dari leluhur: ${path}`}
                >
                  {path}
                </span>
              ))}
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onToggleCollapse(block.id)}
              className="text-[12px] text-ink-faint"
            >
              +{hiddenCount} tersembunyi
            </button>
          )}

          {children}
        </div>
      </div>
    </div>
  )
})
