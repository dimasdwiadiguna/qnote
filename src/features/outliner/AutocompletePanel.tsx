import { useEffect, useState } from 'react'
import { db } from '../../db/db'
import { blockTitle } from '../../db/indexing'
import { normalizeName } from '../../lib/normalize'
import type { Trigger, TriggerKind } from '../../lib/autocomplete'

/**
 * Saran inline saat mengetik `#`, `[`, atau `[[` (brief §4).
 * Panel muncul menempel di bawah bullet yang sedang diedit, di atas toolbar.
 */

export interface Suggestion {
  value: string
  hint?: string
  isNew?: boolean
}

const LABEL: Record<TriggerKind, string> = {
  tag: 'Tag',
  category: 'Kategori',
  link: 'Blok dipromosikan',
  ayat: 'Ayat',
}

async function loadSuggestions(kind: TriggerKind, query: string): Promise<Suggestion[]> {
  const needle = normalizeName(query)

  if (kind === 'tag') {
    const rows = await db.tags.toArray()
    return rows
      .filter((row) => !row.deleted_at && row.name.includes(needle))
      .slice(0, 8)
      .map((row) => ({ value: row.name }))
  }

  if (kind === 'category') {
    const rows = await db.categories.toArray()
    return rows
      .filter((row) => !row.deleted_at && row.path.includes(needle))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 8)
      .map((row) => ({ value: row.path, hint: row.parent_id ? 'turunan' : undefined }))
  }

  if (kind === 'link') {
    // Hanya blok DIPROMOSIKAN yang boleh jadi target wiki-link (brief §2.4).
    const rows = await db.blocks.where('is_promoted').equals(1).toArray()
    return rows
      .filter((row) => !row.deleted_at)
      .map((row) => ({ value: blockTitle(row) }))
      .filter((item) => item.value.length > 0 && normalizeName(item.value).includes(needle))
      .slice(0, 8)
  }

  return []
}

export interface AutocompletePanelProps {
  trigger: Trigger
  onPick: (value: string) => void
  onDismiss: () => void
}

export function AutocompletePanel({
  trigger,
  onPick,
  onDismiss,
}: AutocompletePanelProps): JSX.Element | null {
  const [items, setItems] = useState<Suggestion[]>([])

  useEffect(() => {
    let alive = true
    void loadSuggestions(trigger.kind, trigger.query).then((rows) => {
      if (!alive) return
      const typed = trigger.query.trim()
      const exists = rows.some(
        (row) => normalizeName(row.value) === normalizeName(typed),
      )
      // Mengetik nama baru harus selalu bisa — kategori & tag dibuat otomatis.
      const withNew =
        typed.length > 0 && !exists && trigger.kind !== 'link'
          ? [{ value: typed, isNew: true }, ...rows]
          : rows
      setItems(withNew)
    })
    return () => {
      alive = false
    }
  }, [trigger.kind, trigger.query])

  if (items.length === 0) return null

  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-ink-faint/25 bg-paper-card shadow-lg">
      <div className="border-b border-ink-faint/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {LABEL[trigger.kind]}
      </div>
      {items.map((item) => (
        <button
          key={`${item.value}-${item.isNew ? 'new' : 'old'}`}
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            onPick(item.value)
          }}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[15px] active:bg-accent-soft"
        >
          <span className="truncate">{item.value}</span>
          {item.isNew && <span className="text-[11px] text-accent">baru</span>}
          {item.hint && !item.isNew && (
            <span className="text-[11px] text-ink-faint">{item.hint}</span>
          )}
        </button>
      ))}
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault()
          onDismiss()
        }}
        className="w-full px-3 py-1.5 text-left text-[12px] text-ink-faint"
      >
        Tutup saran
      </button>
    </div>
  )
}
