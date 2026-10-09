import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { authHeaders } from '~/lib/auth'
import { ROLES, hasAnyRole, type Role } from '~/lib/roles'

export interface AuthContext {
  supabase: SupabaseClient
  user: User
  roles: Role[]
}

/**
 * Sends the user's access token with every server function call, and on the
 * server builds a Supabase client that acts as that user. No service-role key
 * is used anywhere: RLS decides what each call can read and write.
 */
export const authMiddleware = createMiddleware({ type: 'function' })
  .client(async ({ next }) => next({ headers: await authHeaders() }))
  .server(async ({ next }) => {
    const authorization = getRequestHeader('authorization')
    if (!authorization?.startsWith('Bearer ')) throw new Error('Your session has ended. Please sign in again.')

    const url = process.env.VITE_SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!url || !anonKey) throw new Error('Supabase is not configured on the server.')

    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.auth.getUser(authorization.slice('Bearer '.length))
    if (error || !data.user) throw new Error('Your session has ended. Please sign in again.')

    const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', data.user.id)
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role).filter((r): r is Role => (ROLES as readonly string[]).includes(r))

    return next({ context: { supabase, user: data.user, roles } satisfies AuthContext })
  })

export function requireRoles(ctx: AuthContext, allowed: Role[]) {
  if (!hasAnyRole(ctx.roles, allowed)) throw new Error('You do not have permission to do this.')
}
