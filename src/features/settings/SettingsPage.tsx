import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Session } from '@supabase/supabase-js'

import { db, requestPersistentStorage, storageEstimate } from '../../db/db'
import { createDocument, deleteDocument, listDocuments, renameDocument } from '../../db/repo'
import { resetSeed, runSeed, seedStatus, type SeedProgress } from '../../db/seed'
import { getSupabase, isSupabaseConfigured, sendMagicLink, signOut } from '../../sync/client'
import { readConflictLog, syncNow, type ConflictRecord } from '../../sync/sync'
import type { Route } from '../../ui/router'

/** Setelan: akun & sync, data ayat, dokumen, dan diagnostik penyimpanan. */
export function SettingsPage({
  navigate,
}: {
  navigate: (patch: Partial<Route>) => void
}): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [seed, setSeed] = useState<SeedProgress | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])

  const documents = useLiveQuery(() => listDocuments(), [], [])
  const blockCount = useLiveQuery(() => db.blocks.count(), [], 0)
  const pendingCount = useLiveQuery(() => db.outbox.count(), [], 0)

  useEffect(() => {
    void seedStatus().then(setSeed)
    void storageEstimate().then(setEstimate)
    void readConflictLog().then(setConflicts)
    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersisted)
    }
    const supabase = getSupabase()
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const startSeed = useCallback(async (): Promise<void> => {
    setSeeding(true)
    await runSeed(setSeed)
    setSeed(await seedStatus())
    setSeeding(false)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-ink-faint/15 px-3 py-2">
        <h1 className="text-[17px] font-semibold">Setelan</h1>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-28 pt-4">
        {/* ── Akun & sync ── */}
        <Section title="Akun & sinkronisasi">
          {!isSupabaseConfigured ? (
            <Note>
              Supabase belum dikonfigurasi. App tetap berfungsi penuh secara offline — sync
              adalah lapisan backup, bukan sumber kebenaran. Isi{' '}
              <code className="rounded bg-paper-sunk px-1">VITE_SUPABASE_URL</code> dan{' '}
              <code className="rounded bg-paper-sunk px-1">VITE_SUPABASE_ANON_KEY</code>, lalu
              <strong> redeploy</strong> — nilainya di-bake saat build, bukan dibaca saat runtime.
            </Note>
          ) : session ? (
            <>
              <p className="text-[14px]">
                Masuk sebagai <strong>{session.user.email}</strong>
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void syncNow()}
                  className="rounded-lg bg-accent px-3 py-2 text-[14px] font-medium text-white"
                >
                  Sync sekarang
                </button>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-lg bg-paper-sunk px-3 py-2 text-[14px]"
                >
                  Keluar
                </button>
              </div>
              <p className="mt-2 text-[12px] text-ink-faint">
                {pendingCount} perubahan menunggu kirim.
              </p>
            </>
          ) : (
            <>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="email@contoh.com"
                className="w-full rounded-lg bg-paper-sunk px-3 py-2 text-[16px] outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  void sendMagicLink(email).then(({ error }) =>
                    setAuthMessage(error ?? 'Tautan masuk terkirim. Cek email.'),
                  )
                }}
                className="mt-2 rounded-lg bg-accent px-3 py-2 text-[14px] font-medium text-white"
              >
                Kirim magic link
              </button>
              {authMessage && <Note>{authMessage}</Note>}
            </>
          )}

          {conflicts.length > 0 && (
            <details className="mt-3">
              <summary className="text-[13px] text-ink-soft">
                Catatan konflik ({conflicts.length})
              </summary>
              <ul className="mt-1 space-y-0.5 text-[12px] text-ink-faint">
                {conflicts.slice(0, 15).map((conflict, i) => (
                  <li key={i}>
                    {conflict.table} · {conflict.row_id.slice(0, 8)} · {conflict.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        {/* ── Data Quran ── */}
        <Section title="Data Quran">
          <p className="text-[14px] text-ink-soft">
            {seed?.done
              ? `Lengkap — ${seed.ayatCount} ayat tersimpan di perangkat.`
              : `Terimpor ${seed?.surahsLoaded ?? 0} dari 114 surah.`}
          </p>
          {seed && !seed.done && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-sunk">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${(seed.surahsLoaded / seed.totalSurahs) * 100}%` }}
              />
            </div>
          )}
          {seed?.error && <Note>Gagal: {seed.error}. Impor bisa diulang tanpa duplikasi.</Note>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={seeding || seed?.done}
              onClick={() => void startSeed()}
              className="rounded-lg bg-accent px-3 py-2 text-[14px] font-medium text-white disabled:bg-ink-faint"
            >
              {seeding ? 'Mengimpor…' : 'Impor sekarang'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Hapus data ayat lalu impor ulang?')) {
                  void resetSeed().then(() => void seedStatus().then(setSeed))
                }
              }}
              className="rounded-lg bg-paper-sunk px-3 py-2 text-[14px]"
            >
              Impor ulang
            </button>
          </div>
          <Note>
            Sumber: Kemenag (Arab + terjemah Indonesia). Data ini read-only dan tidak pernah ikut
            sync.
          </Note>
        </Section>

        {/* ── Dokumen ── */}
        <Section title="Dokumen">
          <ul className="space-y-1">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate({ view: 'outline', documentId: document.id, zoom: null })}
                  className="min-w-0 flex-1 truncate text-left text-[15px]"
                >
                  {document.title}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const title = window.prompt('Judul dokumen', document.title)
                    if (title) void renameDocument(document.id, title)
                  }}
                  className="text-[12px] text-ink-faint"
                >
                  ubah
                </button>
                {documents.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Hapus dokumen "${document.title}" beserta isinya?`)) {
                        void deleteDocument(document.id)
                      }
                    }}
                    className="text-[12px] text-red-700"
                  >
                    hapus
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void createDocument().then((doc) => navigate({ view: 'outline', documentId: doc.id, zoom: null }))}
            className="mt-2 rounded-lg bg-paper-sunk px-3 py-2 text-[14px]"
          >
            + dokumen baru
          </button>
        </Section>

        {/* ── Penyimpanan ── */}
        <Section title="Penyimpanan">
          <p className="text-[14px] text-ink-soft">
            {blockCount} bullet tersimpan.
            {estimate &&
              ` ${(estimate.usage / 1024 / 1024).toFixed(1)} MB terpakai dari ${(
                estimate.quota /
                1024 /
                1024
              ).toFixed(0)} MB.`}
          </p>
          <p className="mt-1 text-[14px]">
            Storage persisten:{' '}
            <strong className={persisted ? 'text-accent' : 'text-red-700'}>
              {persisted === null ? '…' : persisted ? 'aktif' : 'belum aktif'}
            </strong>
          </p>
          {persisted === false && (
            <>
              <Note>
                Tanpa ini, iOS Safari berhak mengosongkan IndexedDB saat storage menipis — dan
                itu berarti kehilangan sumber kebenaran. Pasang app ke Home Screen dan aktifkan
                sync sebagai cadangan nyata.
              </Note>
              <button
                type="button"
                onClick={() => void requestPersistentStorage().then(setPersisted)}
                className="mt-2 rounded-lg bg-accent px-3 py-2 text-[14px] font-medium text-white"
              >
                Minta storage persisten
              </button>
            </>
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section>
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      <div className="rounded-lg border border-ink-faint/20 bg-paper-card p-3">{children}</div>
    </section>
  )
}

function Note({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{children}</p>
}
