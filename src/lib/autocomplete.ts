/**
 * Deteksi pemicu autocomplete tepat di depan kursor.
 *
 * Sama seperti parser, `[[` WAJIB dicek sebelum `[` — kalau tidak, mengetik
 * `[[` akan memunculkan saran kategori dan penanda link tidak pernah terbentuk.
 */

export type TriggerKind = 'tag' | 'category' | 'link' | 'ayat'

export interface Trigger {
  kind: TriggerKind
  /** Teks yang sudah diketik setelah penanda. */
  query: string
  /** Offset penanda pembuka di dalam teks. */
  start: number
}

/** Karakter yang mengakhiri query autocomplete. */
const STOP = /[\s\]]/

export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)

  // Cari penanda pembuka terdekat ke belakang, tanpa melewati pemisah.
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const ch = before[i] as string

    if (STOP.test(ch)) {
      // Spasi mengakhiri pencarian KECUALI untuk kategori & link, yang boleh
      // memuat spasi (`[dakwah/manhaj]`, `[[Blok A]]`).
      const rest = before.slice(0, i)
      let open = rest.lastIndexOf('[')
      if (open === -1) return null
      if (before.indexOf(']', open) !== -1) return null
      // Mundur satu karakter bila ini kurung kedua dari `[[`.
      if (rest[open - 1] === '[') open -= 1
      if (before.slice(open, open + 2) === '[[') {
        return { kind: 'link', query: before.slice(open + 2), start: open }
      }
      return { kind: 'category', query: before.slice(open + 1), start: open }
    }

    if (ch === '[') {
      if (before[i - 1] === '[') {
        return { kind: 'link', query: before.slice(i + 1), start: i - 1 }
      }
      if (before[i + 1] === '[') {
        return { kind: 'link', query: before.slice(i + 2), start: i }
      }
      return { kind: 'category', query: before.slice(i + 1), start: i }
    }

    if (ch === '#') {
      return { kind: 'tag', query: before.slice(i + 1), start: i }
    }

    if (ch === '@') {
      return { kind: 'ayat', query: before.slice(i + 1), start: i }
    }
  }

  return null
}

export interface Replacement {
  text: string
  caret: number
}

/** Mengganti rentang pemicu dengan penanda lengkap dan menaruh kursor sesudahnya. */
export function applyCompletion(
  text: string,
  trigger: Trigger,
  caret: number,
  value: string,
): Replacement {
  const head = text.slice(0, trigger.start)
  const tail = text.slice(caret)
  let inserted: string
  switch (trigger.kind) {
    case 'tag':
      inserted = `#${value} `
      break
    case 'category':
      inserted = `[${value}] `
      break
    case 'link':
      inserted = `[[${value}]] `
      break
    case 'ayat':
      inserted = ''
      break
  }
  return { text: head + inserted + tail, caret: head.length + inserted.length }
}

/** Membuang teks pemicu (dipakai saat `@` membuka palet ayat). */
export function removeTrigger(text: string, trigger: Trigger, caret: number): Replacement {
  const head = text.slice(0, trigger.start)
  return { text: head + text.slice(caret), caret: head.length }
}
