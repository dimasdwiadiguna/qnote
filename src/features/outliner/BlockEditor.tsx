import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { segmentContent } from '../../lib/parser'

/**
 * Field satu bullet — textarea SUNGGUHAN yang selalu terpasang.
 *
 * Kenapa selalu terpasang, dan bukan hanya pada baris yang sedang difokus:
 * menukar `<div>` menjadi `<textarea>` saat disentuh berarti elemen yang sedang
 * fokus dibongkar lalu elemen baru dipasang. Di iOS Safari itu mematikan:
 * membongkar elemen terfokus melempar fokus ke `<body>` dan keyboard turun,
 * dan `.focus()` yang dipanggil setelah `await` sudah di luar jendela gestur
 * pengguna sehingga Safari MENOLAK membuka keyboard lagi. Hasilnya: keyboard
 * berkedip turun tiap kali pindah bullet.
 *
 * Dengan setiap baris punya textarea sendiri, menyentuh bullet lain adalah
 * perpindahan fokus native — nol JS, keyboard tidak pernah turun, dan kursor
 * mendarat persis di titik yang disentuh.
 *
 * Penanda berwarna digambar di lapisan CERMIN tepat di belakang textarea yang
 * teksnya transparan. Cermin itu juga yang menentukan tinggi baris, jadi tidak
 * ada pengukuran `scrollHeight` sama sekali.
 */

export interface BlockEditorHandle {
  focus: (caret?: number) => void
  getValue: () => string
  setValue: (value: string, caret?: number) => void
  getCaret: () => number
  element: () => HTMLTextAreaElement | null
  /**
   * Menutup baris ini selagi fokus berpindah ke bullet yang baru dibuat.
   * Membuat bullet baru harus menunggu Dexie, dan dalam celah itu textarea
   * lama masih yang terfokus — tanpa kunci ini, huruf yang terlanjur diketik
   * mendarat di bullet SEBELUMNYA dan diam-diam menyambung dua catatan.
   * Huruf yang masuk selama terkunci ditampung, bukan dibuang.
   */
  lock: () => void
  /** Membuka kunci dan mengembalikan huruf yang tertampung. */
  release: () => string
}

export interface BlockEditorProps {
  blockId: string
  /** Nilai dari Dexie. Hanya ditulis ke DOM saat baris ini TIDAK sedang difokus. */
  value: string
  placeholder: string
  onInput: (blockId: string, value: string, caret: number) => void
  onKeyDown: (blockId: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: (blockId: string) => void
  onBlur: (blockId: string) => void
  onCaretMove: (blockId: string, caret: number) => void
  register: (blockId: string, handle: BlockEditorHandle | null) => void
}

const MARK_CLASS: Record<string, string> = {
  tag: 'mark mark-tag',
  category: 'mark mark-category',
  link: 'mark mark-link',
}

export function BlockEditor({
  blockId,
  value,
  placeholder,
  onInput,
  onKeyDown,
  onFocus,
  onBlur,
  onCaretMove,
  register,
}: BlockEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lockedRef = useRef(false)
  const bufferRef = useRef('')
  // Teks yang sedang tampil di cermin. Selalu dari DOM saat mengetik, supaya
  // chip menyusul keystroke tanpa menunggu autosave 400 ms.
  const [text, setText] = useState(value)

  const apply = useCallback((next: string, caret?: number): void => {
    const element = textareaRef.current
    if (element) {
      element.value = next
      if (caret !== undefined) {
        const position = Math.max(0, Math.min(caret, next.length))
        element.setSelectionRange(position, position)
      }
    }
    setText(next)
  }, [])

  const handle = useMemo<BlockEditorHandle>(
    () => ({
      focus: (caret) => {
        const element = textareaRef.current
        if (!element) return
        element.focus({ preventScroll: true })
        const raw = element.value
        const position =
          caret === undefined || caret < 0 ? raw.length : Math.min(caret, raw.length)
        element.setSelectionRange(position, position)
      },
      getValue: () => textareaRef.current?.value ?? text,
      setValue: apply,
      getCaret: () => textareaRef.current?.selectionStart ?? 0,
      element: () => textareaRef.current,
      lock: () => {
        lockedRef.current = true
        bufferRef.current = ''
        // `readOnly`, bukan `disabled`: elemen disabled kehilangan fokus dan
        // keyboard iOS langsung turun — persis yang sedang kita hindari.
        const element = textareaRef.current
        if (element) element.readOnly = true
      },
      release: () => {
        lockedRef.current = false
        const element = textareaRef.current
        if (element) element.readOnly = false
        const buffered = bufferRef.current
        bufferRef.current = ''
        return buffered
      },
    }),
    [apply, text],
  )

  // Daftarkan handle supaya OutlinePage bisa memfokus baris mana pun secara
  // langsung — tanpa menunggu render, karena elemennya sudah ada.
  useLayoutEffect(() => {
    register(blockId, handle)
    return () => register(blockId, null)
  }, [blockId, handle, register])

  /**
   * Menyusul perubahan dari luar (sync, undo, konversi blok) — TAPI tidak
   * pernah saat baris ini sedang difokus. Menulis ulang `value` di tengah
   * mengetik akan melompatkan kursor; itulah alasan textarea ini uncontrolled.
   */
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    if (document.activeElement === element) return
    if (element.value === value) return
    element.value = value
    setText(value)
  }, [value])

  const segments = useMemo(() => segmentContent(text), [text])

  return (
    <div className="relative">
      <div aria-hidden className="bullet-mirror">
        {text.length === 0 ? (
          <span className="text-ink-faint">{placeholder}</span>
        ) : (
          segments.map((segment, index) =>
            segment.type === 'text' ? (
              <span key={index}>{segment.text}</span>
            ) : (
              <span key={index} className={MARK_CLASS[segment.token.kind]}>
                {text.slice(segment.token.start, segment.token.end)}
              </span>
            ),
          )
        )}
        {/* Menjaga tinggi baris terakhir saat teks berakhir dengan newline. */}
        {'​'}
      </div>

      <textarea
        ref={textareaRef}
        rows={1}
        spellCheck={false}
        autoCapitalize="sentences"
        autoCorrect="off"
        autoComplete="off"
        enterKeyHint="enter"
        defaultValue={value}
        className="bullet-input"
        onInput={(event) => {
          const element = event.currentTarget
          setText(element.value)
          onInput(blockId, element.value, element.selectionStart)
        }}
        onKeyDown={(event) => {
          if (lockedRef.current) {
            // Tampung huruf biasa; abaikan tombol kendali.
            if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
              bufferRef.current += event.key
            }
            event.preventDefault()
            return
          }
          onKeyDown(blockId, event)
        }}
        onFocus={() => onFocus(blockId)}
        onBlur={() => onBlur(blockId)}
        onSelect={(event) => onCaretMove(blockId, event.currentTarget.selectionStart)}
      />
    </div>
  )
}
