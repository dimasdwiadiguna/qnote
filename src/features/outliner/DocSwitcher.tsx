import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { createDocument, deleteDocument, listDocuments, renameDocument } from '../../db/repo'
import type { Document } from '../../db/types'

/**
 * Pemilih catatan.
 *
 * Lapisan `documents` sudah ada di skema sejak awal — tiap blok membawa
 * `document_id`. Yang belum ada cuma pintunya: memulai catatan baru saat duduk
 * di kajian harus bisa dilakukan dalam dua sentuhan, bukan lewat Setelan.
 */

export interface DocSwitcherProps {
  open: boolean
  activeId: string | null
  onClose: () => void
  onPick: (documentId: string) => void
  onCreated: (documentId: string) => void
}

export function DocSwitcher({
  open,
  activeId,
  onClose,
  onPick,
  onCreated,
}: DocSwitcherProps): JSX.Element | null {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const documents = useLiveQuery(() => listDocuments(), [], [] as Document[])
  const counts = useLiveQuery(
    async () => {
      const blocks = await db.blocks.toArray()
      const map = new Map<string, number>()
      for (const block of blocks) {
        if (block.deleted_at) continue
        if (block.content.trim().length === 0 && block.block_type === 'text') continue
        map.set(block.document_id, (map.get(block.document_id) ?? 0) + 1)
      }
      return map
    },
    [],
    new Map<string, number>(),
  )

  useEffect(() => {
    if (!open) {
      setCreating(false)
      setTitle('')
    }
  }, [open])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  if (!open) return null

  const submit = async (): Promise<void> => {
    const name = title.trim() || 'Catatan baru'
    const document = await createDocument(name)
    setCreating(false)
    setTitle('')
    onCreated(document.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/30" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-paper-card pb-[env(safe-area-inset-bottom)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto my-2 h-1 w-10 rounded-full bg-ink-faint/40" />
        <h2 className="px-4 pb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
          Catatan
        </h2>

        <ul>
          {documents.map((document) => (
            <li key={document.id} className="flex items-center border-t border-ink-faint/10">
              <button
                type="button"
                onClick={() => onPick(document.id)}
                className="min-w-0 flex-1 px-4 py-3 text-left"
              >
                <span
                  className={`block truncate text-[16px] ${
                    document.id === activeId ? 'font-semibold text-accent' : 'text-ink'
                  }`}
                >
                  {document.title}
                </span>
                <span className="block text-[12px] text-ink-faint">
                  {counts.get(document.id) ?? 0} bullet
                </span>
              </button>
              <button
                type="button"
                aria-label={`Ubah judul ${document.title}`}
                onClick={() => {
                  const next = window.prompt('Judul catatan', document.title)
                  if (next && next.trim()) void renameDocument(document.id, next.trim())
                }}
                className="tap-target px-1 text-[13px] text-ink-faint"
              >
                ubah
              </button>
              {documents.length > 1 && (
                <button
                  type="button"
                  aria-label={`Hapus ${document.title}`}
                  onClick={() => {
                    const count = counts.get(document.id) ?? 0
                    const message =
                      count > 0
                        ? `Hapus "${document.title}" beserta ${count} bullet di dalamnya?`
                        : `Hapus "${document.title}"?`
                    if (!window.confirm(message)) return
                    void deleteDocument(document.id).then(() => {
                      if (document.id === activeId) {
                        const next = documents.find((d) => d.id !== document.id)
                        if (next) onPick(next.id)
                      }
                    })
                  }}
                  className="tap-target px-3 text-[13px] text-red-700"
                >
                  hapus
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="border-t border-ink-faint/10 p-3">
          {creating ? (
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit()
                  if (event.key === 'Escape') setCreating(false)
                }}
                placeholder="Judul kajian…"
                enterKeyHint="done"
                className="min-w-0 flex-1 rounded-lg bg-paper-sunk px-3 py-2.5 text-[16px] outline-none"
              />
              <button
                type="button"
                onClick={() => void submit()}
                className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-[15px] font-medium text-white"
              >
                Mulai
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full rounded-lg bg-accent px-4 py-3 text-[16px] font-medium text-white"
            >
              + Catatan baru
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
