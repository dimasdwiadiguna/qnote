import { useCallback, useEffect, useState } from 'react'

/**
 * Router seadanya di atas History API. Tidak ada library: app ini punya enam
 * layar dan satu parameter zoom. Static SPA di Vercel + rewrite ke index.html
 * (lihat vercel.json) membuat path apa pun tetap sampai ke sini.
 */

export type ViewName =
  | 'outline'
  | 'candidates'
  | 'search'
  | 'drill'
  | 'inspirasi'
  | 'settings'

export interface Route {
  view: ViewName
  documentId: string | null
  zoom: string | null
  /** Blok yang ingin difokuskan setelah pindah layar (mis. dari hasil cari). */
  focus: string | null
}

const VIEWS: ReadonlySet<string> = new Set([
  'outline',
  'candidates',
  'search',
  'drill',
  'inspirasi',
  'settings',
])

export function readRoute(): Route {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('v')
  return {
    view: view && VIEWS.has(view) ? (view as ViewName) : 'outline',
    documentId: params.get('doc'),
    zoom: params.get('zoom'),
    focus: params.get('focus'),
  }
}

function toSearch(route: Route): string {
  const params = new URLSearchParams()
  if (route.view !== 'outline') params.set('v', route.view)
  if (route.documentId) params.set('doc', route.documentId)
  if (route.zoom) params.set('zoom', route.zoom)
  if (route.focus) params.set('focus', route.focus)
  const query = params.toString()
  return query ? `?${query}` : window.location.pathname
}

export function useRoute(): [Route, (next: Partial<Route>, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => readRoute())

  useEffect(() => {
    const onPop = (): void => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback(
    (patch: Partial<Route>, replace = false): void => {
      setRoute((previous) => {
        const next: Route = { ...previous, ...patch }
        const url = toSearch(next)
        if (replace) window.history.replaceState(null, '', url)
        else window.history.pushState(null, '', url)
        return next
      })
    },
    [],
  )

  return [route, navigate]
}
