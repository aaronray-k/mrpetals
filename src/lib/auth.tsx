import * as React from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { getSupabase, isSupabaseConfigured } from '~/lib/supabase'
import { ROLES, type Role } from '~/lib/roles'

export interface Profile {
  id: string
  full_name: string | null
  company_name: string | null
  show_tips: boolean
  farm_id: string | null
  customer_id: string | null
}

interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in' | 'not-configured'
  session: Session | null
  profile: Profile | null
  roles: Role[]
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = React.useState<Session | null>(null)
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [roles, setRoles] = React.useState<Role[]>([])
  const [status, setStatus] = React.useState<AuthState['status']>(isSupabaseConfigured ? 'loading' : 'not-configured')

  const loadUserData = React.useCallback(async (userId: string) => {
    const supabase = getSupabase()
    const [profileRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, company_name, show_tips, farm_id, customer_id').eq('id', userId).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', userId),
    ])
    setProfile((profileRes.data as Profile | null) ?? null)
    setRoles(
      (rolesRes.data ?? []).map((r: { role: string }) => r.role).filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
    )
  }, [])

  React.useEffect(() => {
    if (!isSupabaseConfigured) return
    const supabase = getSupabase()
    let active = true

    const apply = async (s: Session | null) => {
      if (!active) return
      setSession(s)
      // Cached data belongs to the previous user (shared PCs at the packhouse).
      queryClient.clear()
      if (s) {
        // Stay "loading" until roles are known, so pages never render for a user without them.
        setStatus('loading')
        await loadUserData(s.user.id)
        if (active) setStatus('signed-in')
      } else {
        setProfile(null)
        setRoles([])
        setStatus('signed-out')
      }
    }

    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Token refreshes don't change who the user is; skip the reload.
      if (event === 'TOKEN_REFRESHED') setSession(s)
      // Deferred: supabase-js can deadlock if Supabase is called inside this callback.
      else if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') setTimeout(() => void apply(s), 0)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadUserData, queryClient])

  const value = React.useMemo<AuthState>(
    () => ({
      status,
      session,
      profile,
      roles,
      signOut: async () => {
        await getSupabase().auth.signOut()
      },
      refreshProfile: async () => {
        if (session) await loadUserData(session.user.id)
      },
    }),
    [status, session, profile, roles, loadUserData],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Header for server functions, so they can act as the signed-in user (RLS applies on the server too). */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}
