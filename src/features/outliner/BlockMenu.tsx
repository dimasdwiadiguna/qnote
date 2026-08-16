import { useEffect, useState } from 'react'
import { countDescendants } from '../../db/repo'
import type { Block } from '../../db/types'

/**
 * Menu long-press sebuah bullet.
 *
 * "Jadikan blok" adalah SATU-SATUNYA jalan promosi (brief §2.4) — tidak ada
 * promosi otomatis karena sebuah bullet kebetulan punya tag atau ayat. Promosi
 * hanya mengubah flag `is_promoted`; tidak ada data yang berpindah dan bisa
 * dibatalkan kapan saja.
 */

export interface BlockMenuProps {
  block: Block | null
  onClose: () => void
  onTogglePromote: (block: Block) => void
  onZoom: (blockId: string) => void
  onDelete: (block: Block) => void
  onShowBacklinks: (blockId: string) => void
}

export function BlockMenu({
  block,
  onClose,
  onTogglePromote,
  onZoom,
  onDelete,
  onShowBacklinks,
}: BlockMenuProps): JSX.Element | null {
  const [descendants, setDescendants] = useState(0)

  useEffect(() => {
    if (!block) return
    let alive = true
    void countDescendants(block.id, block.document_id).then((count) => {
      if (alive) setDescendants(count)
    })
    return () => {
      alive = false
    }
  }, [block])

  if (!block) return null

  const isAyat = block.block_type === 'ayat'
  const promoted = block.is_promoted === 1

  const confirmDelete = (): void => {
    // Menghapus ayat yang punya anak harus dikonfirmasi dulu (brief §5).
    if (descendants > 0) {
      const label = isAyat ? 'Ayat ini' : 'Bullet ini'
      const ok = window.confirm(
        `${label} punya ${descendants} bullet di bawahnya. Hapus semuanya?`,
      )
      if (!ok) return
    } else if (isAyat) {
      if (!window.confirm('Hapus kartu ayat ini?')) return
    }
    onDelete(block)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/30" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-paper-card pb-[env(safe-area-inset-bottom)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto my-2 h-1 w-10 rounded-full bg-ink-faint/40" />

        <p className="line-clamp-2 px-4 pb-2 text-[13px] text-ink-soft">
          {isAyat
            ? `Kartu ayat QS ${block.ayat_surah}:${block.ayat_number}`
            : block.content.trim() || 'Bullet kosong'}
        </p>

        <MenuItem
          label={promoted ? 'Batalkan promosi' : 'Jadikan blok'}
          hint={
            promoted
              ? 'Berhenti jadi target wiki-link, backlink, dan antrian drill'
              : 'Bisa jadi target [[wiki-link]], punya backlink, masuk drill'
          }
          onPress={() => onTogglePromote(block)}
        />
        <MenuItem label="Zoom ke sini" onPress={() => onZoom(block.id)} />
        {promoted && (
          <MenuItem label="Lihat backlink" onPress={() => onShowBacklinks(block.id)} />
        )}
        <MenuItem
          label={isAyat ? 'Hapus kartu ayat' : 'Hapus bullet'}
          hint={descendants > 0 ? `beserta ${descendants} bullet di bawahnya` : undefined}
          destructive
          onPress={confirmDelete}
        />
        <MenuItem label="Batal" onPress={onClose} />
      </div>
    </div>
  )
}

function MenuItem({
  label,
  hint,
  destructive,
  onPress,
}: {
  label: string
  hint?: string
  destructive?: boolean
  onPress: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`w-full border-t border-ink-faint/10 px-4 py-3 text-left active:bg-paper-sunk ${
        destructive ? 'text-red-700' : 'text-ink'
      }`}
    >
      <span className="block text-[16px]">{label}</span>
      {hint && <span className="block text-[12px] text-ink-faint">{hint}</span>}
    </button>
  )
}
