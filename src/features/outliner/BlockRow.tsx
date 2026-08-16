import { memo, useRef } from 'react'
import type { Ayat, Block, SurahMeta } from '../../db/types'
import type { CategoryAssignment } from '../../lib/inherit'
import type { FlatNode } from '../../lib/tree'
import { AyatCard } from './AyatCard'
import { BlockEditor, type BlockEditorHandle } from './BlockEditor'
import { ContentView, offsetFromPoint } from './ContentView'
import { formatReference } from '../../lib/ayatSearch'

/**
 * Satu baris outline. Blok `'ayat'` adalah warga kelas satu di sini: struktur
 * baris, indentasi, collapse, dan promosi identik dengan blok `'text'` — yang
 * berbeda hanya isi area kontennya (kartu + baris anotasi).
 */

const INDENT_PX = 18
const LONG_PRESS_MS = 450

export interface BlockRowProps {
  node: FlatNode
  categories: CategoryAssignment
  editing: boolean
  ayat: Ayat | undefined
  surah: SurahMeta | undefined
  ayatCardCollapsed: boolean
  editorRef: React.Ref<BlockEditorHandle>
  caretRequest: number | null
  onBeginEdit: (block: Block, caret: number) => void
  onZoom: (blockId: string) => void
  onToggleCollapse: (blockId: string) => void
  onToggleAyatCard: (blockId: string) => void
  onOpenMenu: (blockId: string) => void
  onInput: (value: string, caret: number) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onBlur: () => void
  onCaretMove: (caret: number) => void
  children?: React.ReactNode
}

export const BlockRow = memo(function BlockRow({
  node,
  categories,
  editing,
  ayat,
  surah,
  ayatCardCollapsed,
  editorRef,
  caretRequest,
  onBeginEdit,
  onZoom,
  onToggleCollapse,
  onToggleAyatCard,
  onOpenMenu,
  onInput,
  onKeyDown,
  onBlur,
  onCaretMove,
  children,
}: BlockRowProps) {
  const { block, depth, hasChildren, hiddenCount } = node
  const viewRef = useRef<HTMLDivElement>(null)
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
      <div className="flex items-start gap-1">
        {/* Panah collapse — terpisah dari bullet supaya keduanya bisa disentuh
            dengan jempol tanpa saling menyerempet. */}
        <button
          type="button"
          aria-label={block.is_collapsed ? 'Buka' : 'Ciutkan'}
          onClick={() => hasChildren && onToggleCollapse(block.id)}
          className={`mt-[3px] h-6 w-4 shrink-0 text-[11px] leading-6 text-ink-faint ${
            hasChildren ? 'visible' : 'invisible'
          }`}
        >
          {block.is_collapsed ? '▸' : '▾'}
        </button>

        {/* Bullet: tap = zoom-in, tahan = menu. */}
        <button
          type="button"
          aria-label="Zoom ke bullet ini"
          onPointerDown={startPress}
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
          className="mt-[7px] h-4 w-4 shrink-0"
        >
          <span
            className={`mx-auto block rounded-full ${
              block.is_promoted
                ? 'h-2.5 w-2.5 bg-accent ring-2 ring-accent/25'
                : 'h-1.5 w-1.5 bg-ink-faint'
            } ${block.is_collapsed && hasChildren ? 'ring-4 ring-ink-faint/20' : ''}`}
          />
        </button>

        <div className="relative min-w-0 flex-1 pb-1">
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

          {editing ? (
            <BlockEditor
              ref={editorRef}
              blockId={block.id}
              initialValue={block.content}
              placeholder={isAyat ? 'Anotasi…' : 'Tulis di sini…'}
              autoFocusCaret={caretRequest}
              onInput={onInput}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              onCaretMove={onCaretMove}
            />
          ) : (
            <div
              ref={viewRef}
              onPointerUp={(event) => {
                const container = viewRef.current
                if (!container) return
                const caret = offsetFromPoint(container, event.clientX, event.clientY)
                onBeginEdit(block, caret ?? block.content.length)
              }}
              className="min-h-[26px] cursor-text"
            >
              <ContentView
                content={block.content}
                categories={categories}
                placeholder={isAyat ? 'Anotasi…' : 'Tulis di sini…'}
                muted={isAyat}
              />
            </div>
          )}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => onToggleCollapse(block.id)}
              className="mt-0.5 text-[12px] text-ink-faint"
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
