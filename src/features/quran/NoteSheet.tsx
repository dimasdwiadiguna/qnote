import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createDocument, listDocuments } from '../../db/repo'
import { formatSelection, type AyatRef } from '../../lib/ayatSelection'
import type { Document } from '../../db/types'

/**
 * Sheet anotasi — terbuka DI ATAS pembaca, tidak memindahkan layar.
 *
 * Setelah menyimpan, posisi baca tidak berubah dan pilihan dibersihkan, supaya
 * membaca bisa langsung dilanjutkan. Penanda `#tag` / `[kategori]` / `[[link]]`
 * tetap berlaku karena teks ini masuk ke `content` blok biasa dan diindeks oleh
 * `reindexBlock()` seperti bullet lain.
 */

export interface NoteSheetProps {
  open: boolean
  refs: AyatRef[]
  targetId: string | null
  onClose: () => void
  onSave: (documentId: string, annotation: string) => Promise<void>
  onTargetChange: (documentId: string) => void
}

export function NoteSheet({
  open,
  refs,
  targetId,
  onClose,
  onSave,
  onTargetChange,
}: NoteSheetProps): JSX.Element | null {
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const documents = useLiveQuery(() => listDocuments(), [], [] as Document[])
  const target = documents.find((d) => d.id === targetId) ?? documents[0]

  useEffect(() => {
    if (!open) {
      setText('')
      setPicking(false)
      setSaving(false)
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const submit = async (): Promise<void> => {
    if (!target || saving) return
    setSaving(true)
    await onSave(target.id, text.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/30" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-paper-card pb-[env(safe-area-inset-bottom)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto my-2 h-1 w-10 rounded-full bg-ink-faint/40" />

        <div className="px-4">
          <p className="text-[13px] font-semibold text-accent">{formatSelection(refs)}</p>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            {refs.length === 1
              ? 'Anotasi menempel pada kartu ayat ini.'
              : `${refs.length} ayat akan jadi anak dari catatan ini.`}
          </p>

          <textarea
            ref={inputRef}
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Tadabbur, kaitan, atau penanda… #tag [kategori]"
            className="mt-3 w-full resize-none rounded-lg bg-paper-sunk px-3 py-2.5 text-[16px] leading-relaxed outline-none"
          />

          {/* Tujuan */}
          <div className="mt-3 rounded-lg border border-ink-faint/20">
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="min-w-0">
                <span className="block text-[11px] uppercase tracking-wide text-ink-faint">
                  Tujuan
                </span>
                <span className="block truncate text-[15px] font-medium">
                  {target?.title ?? 'Catatan'}
                </span>
              </span>
              <span className="shrink-0 text-[12px] text-accent">
                {picking ? 'tutup' : 'ganti'}
              </span>
            </button>

            {picking && (
              <div className="border-t border-ink-faint/15">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => {
                      onTargetChange(document.id)
                      setPicking(false)
                    }}
                    className={`block w-full px-3 py-2.5 text-left text-[15px] ${
                      document.id === target?.id ? 'text-accent' : 'text-ink'
                    }`}
                  >
                    {document.title}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const title = window.prompt('Judul catatan baru')
                    if (!title || !title.trim()) return
                    void createDocument(title.trim()).then((created) => {
                      onTargetChange(created.id)
                      setPicking(false)
                    })
                  }}
                  className="block w-full border-t border-ink-faint/15 px-3 py-2.5 text-left text-[15px] text-accent"
                >
                  + Catatan baru
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2 border-t border-ink-faint/15 p-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-paper-sunk px-4 py-3 text-[15px]"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!target || saving}
            onClick={() => void submit()}
            className="flex-[2] rounded-lg bg-accent px-4 py-3 text-[15px] font-medium text-white disabled:bg-ink-faint"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
