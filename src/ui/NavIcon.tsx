/**
 * Ikon navigasi sebagai SVG.
 *
 * Sebelumnya dipakai glyph unicode (✎ ⌕ ◷ ✦ ☆ ⚙). Ukurannya tidak bisa
 * dikendalikan: tiap glyph punya tinggi-x sendiri di tiap font sistem, jadi
 * beberapa tampak jauh lebih kecil dari yang lain dan semuanya terlihat mungil
 * di HP. SVG menggambar pada kotak yang sama persis.
 */

export type NavIconName =
  | 'outline'
  | 'search'
  | 'drill'
  | 'inspirasi'
  | 'candidates'
  | 'settings'

const PATHS: Record<NavIconName, JSX.Element> = {
  outline: (
    <>
      <circle cx="5" cy="6" r="1.6" />
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="5" cy="18" r="1.6" />
      <path d="M10 6h10M10 12h8M10 18h6" strokeLinecap="round" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 20 20" strokeLinecap="round" />
    </>
  ),
  drill: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  inspirasi: (
    <path
      d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9 12 3.5Z"
      strokeLinejoin="round"
    />
  ),
  candidates: (
    <path
      d="m12 4 2.3 4.9 5.2.7-3.8 3.6 1 5.3-4.7-2.6-4.7 2.6 1-5.3-3.8-3.6 5.2-.7L12 4Z"
      strokeLinejoin="round"
    />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"
        strokeLinecap="round"
      />
    </>
  ),
}

export function NavIcon({ name }: { name: NavIconName }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
