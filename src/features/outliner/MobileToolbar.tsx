import type { ReactNode } from 'react'

/**
 * Toolbar mobile — WAJIB (brief §4). Keyboard HP tidak punya `Tab`, jadi tanpa
 * baris ini indent/outdent mustahil dan app tidak bisa dipakai di HP.
 *
 * Semua tombol memakai `onPointerDown` + `preventDefault()`, BUKAN `onClick`.
 * Kalau tidak, menyentuh tombol memindahkan fokus dari textarea, keyboard
 * berkedip turun-naik, dan kursor hilang dari bullet yang sedang diedit.
 */

export interface ToolbarAction {
  key: string
  label: ReactNode
  title: string
  onPress: () => void
  disabled?: boolean
  active?: boolean
}

export interface MobileToolbarProps {
  actions: ToolbarAction[]
  visible: boolean
}

export function MobileToolbar({ actions, visible }: MobileToolbarProps): JSX.Element | null {
  if (!visible) return null

  return (
    <div className="keyboard-dock z-30 border-t border-ink-faint/20 bg-paper-card/95 backdrop-blur">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-2 py-1.5">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            title={action.title}
            aria-label={action.title}
            disabled={action.disabled}
            onPointerDown={(event) => {
              // Jaga fokus tetap di textarea.
              event.preventDefault()
              if (!action.disabled) action.onPress()
            }}
            className={`tap-target shrink-0 rounded-lg px-3 text-[15px] font-medium transition-colors ${
              action.active
                ? 'bg-accent text-white'
                : action.disabled
                  ? 'text-ink-faint'
                  : 'bg-paper-sunk text-ink active:bg-accent-soft'
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
