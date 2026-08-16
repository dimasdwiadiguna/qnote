import { useEffect, useState } from 'react'
import { subscribeSyncStatus, syncNow, type SyncStatus } from '../sync/sync'
import { isSupabaseConfigured } from '../sync/client'

/**
 * Indikator sync: kecil dan tenang (brief §8).
 * Tidak pernah ada blocking spinner — sync bukan sumber kebenaran, jadi
 * statusnya tidak boleh pernah menghalangi menulis.
 */
export function SyncBadge(): JSX.Element | null {
  const [status, setStatus] = useState<SyncStatus | null>(null)

  useEffect(() => subscribeSyncStatus(setStatus), [])

  if (!isSupabaseConfigured || !status) return null

  const { label, tone } = describe(status)

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={status.lastError ?? 'Sinkronkan sekarang'}
      className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}
    >
      {label}
    </button>
  )
}

function describe(status: SyncStatus): { label: string; tone: string } {
  if (status.phase === 'offline') return { label: 'offline', tone: 'text-ink-faint' }
  if (status.phase === 'error') return { label: 'gagal sync', tone: 'text-red-700' }
  if (!status.signedIn) return { label: 'lokal saja', tone: 'text-ink-faint' }
  if (status.phase === 'pushing' || status.phase === 'pulling') {
    return { label: 'menyinkron…', tone: 'text-accent' }
  }
  if (status.pending > 0) {
    return { label: `tertunda (${status.pending})`, tone: 'text-amber-700' }
  }
  return { label: 'tersinkron', tone: 'text-ink-faint' }
}
