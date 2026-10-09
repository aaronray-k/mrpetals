import { createServerFn } from '@tanstack/react-start'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ROLES } from '~/lib/roles'
import { authMiddleware, requireRoles } from './auth'

/**
 * Creating accounts and setting passwords needs Supabase Auth's admin API, which needs the
 * service-role key. That key lives only in the server's environment (SUPABASE_SERVICE_ROLE_KEY),
 * is never sent to a browser, and is used only here, after checking the caller is an Admin.
 * Roles, names and links are then set by the caller through admin_set_user(), under RLS.
 */
function adminAuth() {
  const url = process.env.VITE_SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Creating accounts needs SUPABASE_SERVICE_ROLE_KEY on the server. See docs/backend.md.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin
}

const password = z.string().min(10, 'Temporary passwords need at least 10 characters.').max(72)
const account = z.object({
  fullName: z.string().trim().min(2, 'Give the person\'s name.').max(120),
  roles: z.array(z.enum(ROLES)).min(1, 'Give at least one role.'),
  farmId: z.string().uuid().nullable(),
  customerId: z.string().uuid().nullable(),
})

async function setAccount(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  a: z.infer<typeof account>,
  active: boolean,
) {
  const { error } = await supabase.rpc('admin_set_user', {
    p_user_id: userId,
    p_full_name: a.fullName,
    p_roles: a.roles,
    p_farm_id: a.farmId,
    p_customer_id: a.customerId,
    p_active: active,
  })
  if (error) throw new Error(error.message)
}

export const createAccount = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(account.extend({ email: z.string().trim().toLowerCase().email('Enter a valid email address.'), password }))
  .handler(async ({ data, context }) => {
    requireRoles(context, ['admin'])
    const { data: created, error } = await adminAuth().createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, must_change_password: true },
    })
    if (error || !created.user) throw new Error(error?.message.includes('already') ? `${data.email} already has an account.` : (error?.message ?? 'The account was not created.'))
    await setAccount(context.supabase, created.user.id, data, true)
    return { id: created.user.id }
  })

export const updateAccount = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(account.extend({ userId: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, ['admin'])
    await setAccount(context.supabase, data.userId, data, data.active)
    // A switched-off account can't sign in either.
    const { error } = await adminAuth().updateUserById(data.userId, { ban_duration: data.active ? 'none' : '876000h' })
    if (error) throw new Error(error.message)
    return { ok: true }
  })

export const resetAccountPassword = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string().uuid(), password }))
  .handler(async ({ data, context }) => {
    requireRoles(context, ['admin'])
    const { error } = await adminAuth().updateUserById(data.userId, { password: data.password, user_metadata: { must_change_password: true } })
    if (error) throw new Error(error.message)
    return { ok: true }
  })
