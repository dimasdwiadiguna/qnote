import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'

/**
 * Field satu bullet.
 *
 * UNCONTROLLED — sengaja. `value` yang dikendalikan React plus `useLiveQuery`
 * berarti setiap tulisan Dexie (termasuk yang datang dari sync) menulis ulang
 * isi textarea dan MELOMPATKAN KURSOR di tengah mengetik (risiko R3). Jadi
 * sumber kebenaran saat mengetik adalah DOM; Dexie disusul lewat autosave.
 */

export interface BlockEditorHandle {
  focus: (caret?: number) => void
  getValue: () => string
  setValue: (value: string, caret?: number) => void
  getCaret: () => number
  element: () => HTMLTextAreaElement | null
}

export interface BlockEditorProps {
  blockId: string
  initialValue: string
  placeholder: string
  autoFocusCaret: number | null
  onInput: (value: string, caret: number) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onBlur: () => void
  onCaretMove: (caret: number) => void
  className?: string
  dir?: 'ltr' | 'rtl'
}

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(
  function BlockEditor(
    {
      blockId,
      initialValue,
      placeholder,
      autoFocusCaret,
      onInput,
      onKeyDown,
      onBlur,
      onCaretMove,
      className = '',
      dir = 'ltr',
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const resize = (): void => {
      const element = textareaRef.current
      if (!element) return
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }

    useImperativeHandle(ref, () => ({
      focus: (caret) => {
        const element = textareaRef.current
        if (!element) return
        element.focus({ preventScroll: true })
        if (caret !== undefined) {
          const position = Math.max(0, Math.min(caret, element.value.length))
          element.setSelectionRange(position, position)
        }
      },
      getValue: () => textareaRef.current?.value ?? '',
      setValue: (value, caret) => {
        const element = textareaRef.current
        if (!element) return
        element.value = value
        resize()
        if (caret !== undefined) {
          const position = Math.max(0, Math.min(caret, value.length))
          element.setSelectionRange(position, position)
        }
      },
      getCaret: () => textareaRef.current?.selectionStart ?? 0,
      element: () => textareaRef.current,
    }))

    // Blok berganti (Enter, pindah fokus) → tulis ulang isi & taruh kursor.
    useLayoutEffect(() => {
      const element = textareaRef.current
      if (!element) return
      element.value = initialValue
      resize()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blockId])

    useEffect(() => {
      const element = textareaRef.current
      if (!element || autoFocusCaret === null) return
      element.focus({ preventScroll: true })
      const position =
        autoFocusCaret < 0
          ? element.value.length
          : Math.min(autoFocusCaret, element.value.length)
      element.setSelectionRange(position, position)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blockId, autoFocusCaret])

    useLayoutEffect(resize)

    return (
      <textarea
        ref={textareaRef}
        dir={dir}
        rows={1}
        spellCheck={false}
        autoCapitalize="sentences"
        autoCorrect="off"
        placeholder={placeholder}
        defaultValue={initialValue}
        onInput={(event) => {
          const element = event.currentTarget
          resize()
          onInput(element.value, element.selectionStart)
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onSelect={(event) => onCaretMove(event.currentTarget.selectionStart)}
        className={`w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[16px] leading-[1.65] outline-none placeholder:text-ink-faint focus:ring-0 ${className}`}
      />
    )
  },
)
