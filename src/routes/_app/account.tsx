import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { ROLE_LABELS, hasAnyRole } from '~/lib/roles'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/account')({
  head: () => ({ meta: [{ title: 'My account · ConsolFlora' }] }),
  component: AccountPage,
})

interface Agreement {
  code: string
  title: string
  version: string
  current_version: string
  accepted_at: string
}

function AccountPage() {
  const { session, profile, roles } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const agreements = useQuery({
    queryKey: ['my-agreements'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('my_agreements')
      if (error) throw new Error(error.message)
      return data as Agreement[]
    },
  })
  const marketing = useQuery({
    queryKey: ['my-marketing', session?.user.id],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('profiles').select('marketing_opt_in, marketing_updated_at').eq('id', session!.user.id).single()
      if (error) throw new Error(error.message)
      return data as { marketing_opt_in: boolean; marketing_updated_at: string | null }
    },
    enabled: !!session,
  })
  const [optIn, setOptIn] = React.useState<boolean | null>(null)
  const current = optIn ?? marketing.data?.marketing_opt_in ?? false

  return (
    <>
      <PageHeader title="My account" description="Your details, what you have agreed to, and your email choices." />
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
            <CardDescription>Business contact details only. Ask an Admin to change your name or roles.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="font-semibold">{profile?.full_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Email</dt>
                <dd className="font-semibold break-all">{session?.user.email}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Roles</dt>
                <dd className="font-semibold">{roles.map((r) => ROLE_LABELS[r]).join(', ')}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What you agreed to</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3">
            {agreements.isLoading && <Spinner />}
            {agreements.data && (
              <div className="rounded-lg border">
                <Table>
                  <caption className="sr-only">Documents you agreed to</caption>
                  <THead>
                    <TR>
                      <TH>Document</TH>
                      <TH>Version</TH>
                      <TH>Agreed</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {agreements.data.map((a) => (
                      <TR key={a.code}>
                        <TD>
                          <Link to="/legal/$code" params={{ code: a.code }} className="font-semibold underline">
                            {a.title}
                          </Link>
                        </TD>
                        <TD>
                          {a.version}
                          {a.version !== a.current_version && <Badge className="ml-2">Newer version {a.current_version}</Badge>}
                        </TD>
                        <TD className="whitespace-nowrap">{formatDateTime(a.accepted_at)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        {hasAnyRole(roles, ['customer', 'farm']) && (
          <Card>
            <CardHeader>
              <CardTitle>Email from ConsolFlora</CardTitle>
              <CardDescription>Order emails always come. News and offers only if you want them.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Switch
                checked={current}
                label="Send me news and offers"
                onCheckedChange={async (on) => {
                  setOptIn(on)
                  const { error } = await getSupabase().rpc('set_marketing_opt_in', { p_opt_in: on })
                  if (error) {
                    setOptIn(!on)
                    return toast({ kind: 'error', title: 'Not changed', description: error.message })
                  }
                  toast({ kind: 'success', title: on ? 'You will get news and offers' : 'No more news and offers' })
                  void queryClient.invalidateQueries({ queryKey: ['my-marketing'] })
                }}
              />
              {marketing.data?.marketing_updated_at && (
                <p className="text-sm text-muted-foreground">Last changed {formatDateTime(marketing.data.marketing_updated_at)}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
