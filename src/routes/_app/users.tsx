import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, UserPlus } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { useReferenceData } from '~/lib/orders/api'
import { ROLES, ROLE_LABELS, type Role } from '~/lib/roles'
import { formatDateTime } from '~/lib/utils'
import { createAccount, resetAccountPassword, updateAccount } from '~/server/users.functions'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Field, Input, Select } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/users')({
  head: () => ({ meta: [{ title: 'Users · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/users')}>
      <UsersPage />
    </RequireRole>
  ),
})

interface UserRow {
  id: string
  email: string
  full_name: string | null
  roles: Role[]
  farm_id: string | null
  customer_id: string | null
  active: boolean
  created_at: string
  last_sign_in_at: string | null
}

const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including users and settings',
  consolidator: 'Orders, farms, shipments, labels',
  finance: 'Payments, margins, prices, credit',
  qc: 'Scanning and QC results',
  senior_qc: 'QC, and clears Major failures',
  farm: 'Their farm\'s purchase orders',
  customer: 'Their company\'s orders (buyer)',
}

/** A readable temporary password, e.g. "Rose-7342-Kiwi". */
function tempPassword() {
  const words = ['Rose', 'Lily', 'Tulip', 'Orchid', 'Daisy', 'Iris', 'Peony', 'Aster', 'Freesia', 'Gerbera']
  const n = crypto.getRandomValues(new Uint32Array(3))
  return `${words[n[0]! % words.length]}-${1000 + (n[1]! % 9000)}-${words[n[2]! % words.length]}`
}

function UsersPage() {
  const q = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_list_users')
      if (error) throw new Error(error.message)
      return data as UserRow[]
    },
  })
  const ref = useReferenceData()
  const [editing, setEditing] = React.useState<UserRow | 'new' | null>(null)
  const [resetting, setResetting] = React.useState<UserRow | null>(null)
  const farmName = (id: string | null) => ref.data?.farms.find((f) => f.id === id)?.farm_name
  const buyerName = (id: string | null) => ref.data?.buyers.find((b) => b.id === id)?.company_name

  return (
    <>
      <PageHeader
        title="Users"
        description="Create an account for each person, with the roles they need. They choose their own password at first sign-in."
        actions={
          <Button onClick={() => setEditing('new')}>
            <UserPlus aria-hidden="true" /> New user
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="users.how" title="Handing out accounts">
          Create the account with a temporary password and give it to the person. At their first sign-in they must choose their own. Farm
          users are linked to their farm and buyers to their company, so they only see their own orders.
        </Tip>
        {q.isLoading && <Spinner />}
        {q.error && <Alert variant="destructive" title="Couldn't load users" role="alert">{(q.error as Error).message}</Alert>}
        {q.data && (
          <div className="rounded-lg border bg-card">
            <Table>
              <caption className="sr-only">Users</caption>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Roles</TH>
                  <TH>Linked to</TH>
                  <TH>Status</TH>
                  <TH>Last sign-in</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((u) => (
                  <TR key={u.id} className={u.active ? undefined : 'text-muted-foreground'}>
                    <TD>
                      <span className="font-semibold">{u.full_name ?? '—'}</span>
                      <span className="block text-sm">{u.email}</span>
                    </TD>
                    <TD>{u.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') || 'No role'}</TD>
                    <TD>{farmName(u.farm_id) ?? buyerName(u.customer_id) ?? '—'}</TD>
                    <TD>{u.active ? <Badge variant="success">Active</Badge> : <Badge>Switched off</Badge>}</TD>
                    <TD className="whitespace-nowrap">{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : 'Never'}</TD>
                    <TD className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                        <Pencil aria-hidden="true" /> Change<span className="sr-only"> {u.email}</span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                        <KeyRound aria-hidden="true" /> New password<span className="sr-only"> for {u.email}</span>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
      {editing && <UserDialog user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} />}
    </>
  )
}

function UserDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const ref = useReferenceData()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [email, setEmail] = React.useState(user?.email ?? '')
  const [fullName, setFullName] = React.useState(user?.full_name ?? '')
  const [roles, setRoles] = React.useState<Role[]>(user?.roles ?? [])
  const [farmId, setFarmId] = React.useState(user?.farm_id ?? '')
  const [customerId, setCustomerId] = React.useState(user?.customer_id ?? '')
  const [active, setActive] = React.useState(user?.active ?? true)
  const [password] = React.useState(tempPassword)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (roles.includes('farm') && !farmId) return setError('Choose the farm for this Farm user.')
    if (roles.includes('customer') && !customerId) return setError('Choose the buyer company for this Customer user.')
    setBusy(true)
    setError(null)
    const common = { fullName, roles, farmId: roles.includes('farm') ? farmId : null, customerId: roles.includes('customer') ? customerId : null }
    try {
      if (user) {
        await updateAccount({ data: { ...common, userId: user.id, active } })
        toast({ kind: 'success', title: `${email} saved` })
        onClose()
      } else {
        await createAccount({ data: { ...common, email, password } })
        setDone(true)
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <Dialog open onClose={onClose} title="Account created">
        <div className="grid gap-3">
          <p>Give these to {fullName}. They will choose their own password when they first sign in.</p>
          <dl className="grid gap-1 rounded-md bg-muted p-3">
            <dt className="text-sm font-semibold">Email</dt>
            <dd className="font-mono">{email}</dd>
            <dt className="text-sm font-semibold">Temporary password</dt>
            <dd className="font-mono text-lg">{password}</dd>
          </dl>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Dialog>
    )

  return (
    <Dialog open onClose={onClose} title={user ? `Change ${user.email}` : 'New user'} className="w-[min(40rem,calc(100vw-2rem))]">
      <form onSubmit={save} noValidate className="grid gap-4">
        {error && <Alert variant="destructive" title={error} role="alert" />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="u-email" label="Business email">
            {(d) => <Input id="u-email" type="email" value={email} disabled={!!user} onChange={(e) => setEmail(e.target.value)} aria-describedby={d} />}
          </Field>
          <Field id="u-name" label="Name">
            {(d) => <Input id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} aria-describedby={d} />}
          </Field>
        </div>
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm font-semibold">Roles</legend>
          {ROLES.map((r) => (
            <label key={r} className="flex min-h-10 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-6 shrink-0 accent-accent"
                checked={roles.includes(r)}
                onChange={(e) => setRoles((rs) => (e.target.checked ? [...rs, r] : rs.filter((x) => x !== r)))}
              />
              <span>
                <strong>{ROLE_LABELS[r]}</strong> <span className="text-sm text-muted-foreground">· {ROLE_HELP[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {roles.includes('farm') && (
          <Field id="u-farm" label="Farm">
            {(d) => (
              <Select id="u-farm" value={farmId} onChange={(e) => setFarmId(e.target.value)} aria-describedby={d}>
                <option value="">Choose the farm…</option>
                {ref.data?.farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.farm_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {roles.includes('customer') && (
          <Field id="u-buyer" label="Buyer company">
            {(d) => (
              <Select id="u-buyer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-describedby={d}>
                <option value="">Choose the buyer…</option>
                {ref.data?.buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.company_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {user ? (
          <Switch checked={active} onCheckedChange={setActive} label="Account is active (switched off: can't sign in)" />
        ) : (
          <p className="text-sm">
            Temporary password: <strong className="font-mono">{password}</strong> (shown again after saving)
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : user ? 'Save' : 'Create account'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function ResetDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast()
  const [password] = React.useState(tempPassword)
  const [done, setDone] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  return (
    <Dialog open onClose={onClose} title={`New password for ${user.email}`} description="They must choose their own when they next sign in.">
      <div className="grid gap-3">
        <p>
          Temporary password: <strong className="font-mono text-lg">{password}</strong>
        </p>
        <div className="flex justify-end gap-2">
          {done ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await resetAccountPassword({ data: { userId: user.id, password } })
                    setDone(true)
                    toast({ kind: 'success', title: 'Password set', description: 'Give the temporary password to the person.' })
                  } catch (e) {
                    toast({ kind: 'error', title: 'Not changed', description: (e as Error).message })
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Set this password
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}
