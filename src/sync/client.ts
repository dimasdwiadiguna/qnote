import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Klien Supabase.
 *
 * JEBAKAN VITE DI VERCEL (brief §9.2): nilai `VITE_*` di-BAKE saat build, bukan
 * dibaca saat runtime. Mengubah env var di dashboard Vercel tidak berefek
 * sampai ada redeploy. Karena ter-bundel di JS publik, hanya anon key yang
 * boleh ada di sini — tidak pernah `service_role`. Keamanan nyata satu-satunya
 * adalah RLS di Supabase.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

let cached: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (!cached) {
    cached = createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return cached
}

/**
 * Magic link. `emailRedirectTo` HARUS dari `window.location.origin` — URL
 * preview Vercel berubah tiap commit, jadi redirect yang di-hardcode akan gagal
 * (brief §9.3).
 */
export async function sendMagicLink(email: string): Promise<{ error: string | null }> {
  const supabase = getSupabase()
  if (!supabase) return { error: 'Supabase belum dikonfigurasi.' }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  return { error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut()
}
