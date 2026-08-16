/**
 * Parser penanda inline: `[[wiki-link]]`, `[kategori]`, `#tag`.
 *
 * ATURAN KUNCI (brief §2.6): `[[ ]]` dan `[ ]` berbagi karakter kurung siku.
 * Parser WAJIB mencoba `[[ ]]` lebih dulu; sisanya baru diperlakukan kategori.
 * Karena itu ini scanner karakter satu-pass, bukan rangkaian `String.replace`
 * yang saling menimpa.
 */

import { normalizeName } from './normalize'

export type MarkupKind = 'link' | 'category' | 'tag'

export interface MarkupToken {
  kind: MarkupKind
  /** Offset di `content` mentah, termasuk penanda (`[[`, `[`, `#`). */
  start: number
  /** Offset eksklusif akhir token, termasuk penanda penutup. */
  end: number
  /** Teks di dalam penanda, apa adanya. */
  raw: string
  /** Bentuk ternormalisasi: lowercase, path kategori dirapikan. */
  value: string
}

export interface ParsedContent {
  tokens: MarkupToken[]
  /** Nama tag ternormalisasi, unik, urut kemunculan. */
  tags: string[]
  /** Path kategori ternormalisasi (`dakwah/manhaj`), unik, urut kemunculan. */
  categories: string[]
  /** Target wiki-link ternormalisasi, unik, urut kemunculan. */
  links: string[]
}

/**
 * Kategori sengaja DIBATASI polanya (lihat PLAN.md §9.1): tanpa ini, setiap
 * `[sic]` atau `[lihat catatan buku halaman 40]` dalam kutipan ikut jadi
 * kategori. Huruf/angka/spasi tunggal/underscore/hyphen/slash saja.
 */
const CATEGORY_SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u

/** Karakter yang boleh menyusun `#tag`. Tag itu datar — tidak ada `/`. */
const TAG_CHAR = /[\p{L}\p{N}_-]/u

/** `#` hanya memulai tag bila didahului awal teks atau pemisah. */
function isTagBoundary(prev: string | undefined): boolean {
  return prev === undefined || /[\s([{,;:!?'"“”‘’—–-]/u.test(prev)
}

/**
 * Memecah `dakwah/manhaj` menjadi segmen ternormalisasi.
 * Mengembalikan `null` bila salah satu segmen tidak lolos pola kategori.
 */
export function parseCategoryPath(raw: string): string[] | null {
  const parts = raw.split('/')
  if (parts.length === 0 || parts.length > 6) return null
  const segments: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || !CATEGORY_SEGMENT.test(trimmed)) return null
    segments.push(normalizeName(trimmed))
  }
  return segments
}

/** Mencari `needle` mulai dari `from`, menolak bila ada `[` atau `]` liar di dalam. */
function findClose(source: string, from: number, needle: string): number {
  const close = source.indexOf(needle, from)
  if (close === -1) return -1
  const inner = source.slice(from, close)
  if (inner.includes('[')) return -1
  if (needle === ']' && inner.includes(']')) return -1
  return close
}

export function parseContent(content: string): ParsedContent {
  const tokens: MarkupToken[] = []
  const len = content.length
  let i = 0

  while (i < len) {
    const ch = content[i]

    if (ch === '[') {
      // ── Langkah 1: WAJIB coba `[[ ]]` dulu. ──────────────────────────────
      if (content[i + 1] === '[') {
        const close = findClose(content, i + 2, ']]')
        const raw = close === -1 ? '' : content.slice(i + 2, close).trim()
        if (close !== -1 && raw.length > 0) {
          tokens.push({
            kind: 'link',
            start: i,
            end: close + 2,
            raw,
            value: normalizeName(raw),
          })
          i = close + 2
          continue
        }
        // `[[` menggantung: majukan satu karakter saja, biarkan `[` kedua
        // dicoba sebagai kategori pada iterasi berikutnya.
        i += 1
        continue
      }

      // ── Langkah 2: sisanya baru kategori. ────────────────────────────────
      const close = findClose(content, i + 1, ']')
      if (close !== -1) {
        const raw = content.slice(i + 1, close).trim()
        const segments = raw.length > 0 ? parseCategoryPath(raw) : null
        if (segments) {
          tokens.push({
            kind: 'category',
            start: i,
            end: close + 1,
            raw,
            value: segments.join('/'),
          })
          i = close + 1
          continue
        }
      }
      i += 1
      continue
    }

    // ── Langkah 3: `#tag`. ──────────────────────────────────────────────────
    if (ch === '#' && isTagBoundary(content[i - 1])) {
      let j = i + 1
      while (j < len && TAG_CHAR.test(content[j] as string)) j += 1
      const raw = content.slice(i + 1, j)
      if (raw.length > 0) {
        tokens.push({ kind: 'tag', start: i, end: j, raw, value: normalizeName(raw) })
        i = j
        continue
      }
    }

    i += 1
  }

  const pick = (kind: MarkupKind): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const token of tokens) {
      if (token.kind !== kind) continue
      if (seen.has(token.value)) continue
      seen.add(token.value)
      out.push(token.value)
    }
    return out
  }

  return {
    tokens,
    tags: pick('tag'),
    categories: pick('category'),
    links: pick('link'),
  }
}

/** Teks tanpa penanda — untuk indeks pencarian, kartu Inspirasi, dan drill. */
export function stripMarkup(content: string): string {
  const { tokens } = parseContent(content)
  if (tokens.length === 0) return content.trim()
  let out = ''
  let cursor = 0
  for (const token of tokens) {
    out += content.slice(cursor, token.start)
    // Wiki-link tetap menyumbang teksnya; tag & kategori adalah metadata murni.
    if (token.kind === 'link') out += token.raw
    cursor = token.end
  }
  out += content.slice(cursor)
  return out.replace(/\s+/g, ' ').trim()
}

/** Potongan siap-render: teks biasa diselingi chip penanda. */
export type ContentSegment =
  | { type: 'text'; text: string }
  | { type: 'token'; token: MarkupToken }

export function segmentContent(content: string): ContentSegment[] {
  const { tokens } = parseContent(content)
  const segments: ContentSegment[] = []
  let cursor = 0
  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ type: 'text', text: content.slice(cursor, token.start) })
    }
    segments.push({ type: 'token', token })
    cursor = token.end
  }
  if (cursor < content.length) {
    segments.push({ type: 'text', text: content.slice(cursor) })
  }
  return segments
}

/** Semua leluhur sebuah path kategori, termasuk dirinya: `a/b/c` → a, a/b, a/b/c. */
export function categoryAncestry(path: string): string[] {
  const segments = path.split('/')
  const out: string[] = []
  for (let i = 0; i < segments.length; i += 1) {
    out.push(segments.slice(0, i + 1).join('/'))
  }
  return out
}
