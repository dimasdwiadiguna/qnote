import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { db, getMeta, META, requestPersistentStorage, setMeta } from './db/db'
import { ensureDefaultDocument } from './db/repo'
import { isSeeded, runSeed, type SeedProgress } from './db/seed'
import { startAutoSync } from './sync/sync'
import { buildSearchIndex, candidateBlocks } from './lib/search'
import { useKeyboardInset } from './ui/hooks'
import { useRoute, type ViewName } from './ui/router'
import { SyncBadge } from './ui/SyncBadge'

import { OutlinePage } from './features/outliner/OutlinePage'
import { CandidatesPage } from './features/candidates/CandidatesPage'
import { SearchPage } from './features/search/SearchPage'
import { DrillPage } from './features/drill/DrillPage'
import { InspirasiPage } from './features/inspirasi/InspirasiPage'
import { SettingsPage } from './features/settings/SettingsPage'

const NAV: { view: ViewName; label: string; icon: string }[] = [
  { view: 'outline', label: 'Tulis', icon: '✎' },
  { view: 'search', label: 'Cari', icon: '⌕' },
  { view: 'drill', label: 'Drill', icon: '◷' },
  { view: 'inspirasi', label: 'Inspirasi', icon: '✦' },
  { view: 'candidates', label: 'Kandidat', icon: '☆' },
  { view: 'settings', label: 'Setelan', icon: '⚙' },
]

export function App(): JSX.Element {
  const [route, navigate] = useRoute()
  const [booted, setBooted] = useState(false)
  const [seedProgress, setSeedProgress] = useState<SeedProgress | null>(null)
  const [editing, setEditing] = useState(false)
  const keyboardInset = useKeyboardInset()

  useEffect(() => {
    if (route.documentId) void setMeta(META.lastDocumentId, route.documentId)
  }, [route.documentId])

  useEffect(() => {
    let cancelled = false

    const boot = async (): Promise<void> => {
      // Wajib dipanggil saat boot: tanpa ini iOS Safari berhak mengosongkan
      // IndexedDB saat storage menipis (brief §2.1, risiko R1).
      await requestPersistentStorage()

      // Dokumen terakhir yang dibuka disimpan di meta, bukan hanya di URL:
      // membuka app dari Home Screen selalu mulai dari URL bersih.
      const remembered = await getMeta<string | null>(META.lastDocumentId, null)
      const candidate = route.documentId ?? remembered
      const stored = candidate ? await db.documents.get(candidate) : undefined
      const target = stored && !stored.deleted_at ? stored : await ensureDefaultDocument()
      if (cancelled) return
      if (route.documentId !== target.id) navigate({ documentId: target.id }, true)
      setBooted(true)

      // Impor ayat dijalankan SETELAH first paint dan tidak memblokir apa pun —
      // menulis catatan teks harus bisa dilakukan sebelum impor selesai.
      if (!(await isSeeded())) {
        await runSeed((progress) => {
          if (!cancelled) setSeedProgress(progress.done ? null : progress)
        })
        if (!cancelled) setSeedProgress(null)
      }
    }

    void boot()
    const stopSync = startAutoSync()
    return () => {
      cancelled = true
      stopSync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const candidateCount = useLiveQuery(async () => {
    // Badge kecil di navigasi supaya layar Kandidat tidak terlupakan (risiko R13).
    const blocks = await db.blocks.count()
    if (blocks === 0) return 0
    const index = await buildSearchIndex()
    return candidateBlocks(index).length
  }, [])

  if (!booted) {
    return (
      <div className="flex h-dvh items-center justify-center text-[15px] text-ink-soft">
        Menyiapkan Qnote…
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-[env(safe-area-inset-top)]">
        <span className="py-1 text-[11px] font-semibold uppercase tracking-widest text-accent">
          Qnote
        </span>
        <SyncBadge />
      </div>

      {seedProgress && (
        <div className="border-y border-accent/20 bg-accent-soft/40 px-3 py-1 text-[12px] text-accent-ink">
          Mengimpor data Quran… {seedProgress.surahsLoaded}/{seedProgress.totalSurahs} surah.
          Catatan tetap bisa ditulis sekarang.
        </div>
      )}

      <main className="min-h-0 flex-1">
        {route.view === 'outline' && (
          <OutlinePage route={route} navigate={navigate} onEditingChange={setEditing} />
        )}
        {route.view === 'search' && <SearchPage navigate={navigate} />}
        {route.view === 'drill' && <DrillPage navigate={navigate} />}
        {route.view === 'inspirasi' && <InspirasiPage navigate={navigate} />}
        {route.view === 'candidates' && <CandidatesPage navigate={navigate} />}
        {route.view === 'settings' && <SettingsPage navigate={navigate} />}
      </main>

      {/* Navigasi bawah disembunyikan saat sedang mengetik — toolbar editor yang
          menempati ruang itu. Dua bilah bertumpuk memakan setengah layar HP,
          dan di perangkat tanpa keyboard di layar keduanya akan saling menimpa. */}
      {keyboardInset === 0 && !editing && (
        <nav className="shrink-0 border-t border-ink-faint/20 bg-paper-card pb-[env(safe-area-inset-bottom)]">
          <div className="flex">
            {NAV.map((item) => (
              <button
                key={item.view}
                type="button"
                onClick={() => navigate({ view: item.view })}
                className={`relative flex flex-1 flex-col items-center py-1.5 text-[10px] ${
                  route.view === item.view ? 'text-accent' : 'text-ink-faint'
                }`}
              >
                <span className="text-[17px] leading-6">{item.icon}</span>
                {item.label}
                {item.view === 'candidates' && (candidateCount ?? 0) > 0 && (
                  <span className="absolute right-[18%] top-0.5 rounded-full bg-amber-500 px-1 text-[9px] font-semibold text-white">
                    {candidateCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
