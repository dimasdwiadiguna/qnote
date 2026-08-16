import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Menaikkan toolbar tepat di atas keyboard lewat VisualViewport API.
 *
 * `position: sticky` saja tidak cukup: di iOS Safari keyboard tidak mengubah
 * tinggi layout viewport, jadi toolbar akan tertutup keyboard dan app tidak
 * bisa dipakai di HP (risiko R4). `env(keyboard-inset-height)` belum bisa
 * diandalkan, jadi VisualViewport adalah jalur utama.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = (): void => {
      const overlap = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      )
      // Ambang 40px menyaring bilah alamat yang menyusut saat scroll.
      const value = overlap > 40 ? overlap : 0
      setInset(value)
      document.documentElement.style.setProperty('--keyboard-inset', `${value}px`)
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}

/**
 * Autosave debounce. Mengembalikan `push` (jadwalkan) dan `flush` (kirim
 * sekarang). `flush` dipanggil saat blur, ganti blok, dan sebelum operasi
 * struktur — kalau tidak, Enter bisa menyimpan teks ke blok yang salah.
 */
export function useDebouncedSave(
  save: (id: string, value: string) => Promise<void>,
  delay = 400,
): {
  push: (id: string, value: string) => void
  flush: () => Promise<void>
} {
  const timer = useRef<number | null>(null)
  const pendingRef = useRef<{ id: string; value: string } | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) await saveRef.current(pending.id, pending.value)
  }, [])

  const push = useCallback(
    (id: string, value: string): void => {
      const previous = pendingRef.current
      // Ganti blok sebelum debounce habis: simpan yang lama dulu.
      if (previous && previous.id !== id) {
        void saveRef.current(previous.id, previous.value)
      }
      pendingRef.current = { id, value }
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        const current = pendingRef.current
        pendingRef.current = null
        if (current) void saveRef.current(current.id, current.value)
      }, delay)
    },
    [delay],
  )

  // Jaring pengaman: jangan pernah kehilangan ketikan saat tab ditutup/di-hide.
  useEffect(() => {
    const onHide = (): void => {
      void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [flush])

  return { push, flush }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const on = (): void => setOnline(true)
    const off = (): void => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Menutup panel saat menyentuh di luar elemen. */
export function useDismissOnOutside(
  active: boolean,
  onDismiss: () => void,
): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const handler = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [active, onDismiss])
  return ref
}
