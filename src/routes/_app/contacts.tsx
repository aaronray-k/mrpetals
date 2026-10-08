import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useOdooContacts } from '~/lib/odoo/api'
import { cn } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { TBody, TD, TH, THead, TR, Table } from '~/components/ui/table'

export const Route = createFileRoute('/_app/contacts')({
  head: () => ({ meta: [{ title: 'Contacts · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/contacts')}>
      <ContactsPage />
    </RequireRole>
  ),
})

const KINDS = [
  { key: 'buyers', label: 'Buyers' },
  { key: 'growers', label: 'Growers' },
  { key: 'all', label: 'All' },
] as const
const TYPE: Record<string, string> = { invoice: 'Invoice address', delivery: 'Delivery address', other: 'Other address', private: 'Private' }

/** Contacts as Odoo has them: each company, the people under it and their emails. Edited in Odoo. */
function ContactsPage() {
  const [kind, setKind] = React.useState<'all' | 'buyers' | 'growers'>('buyers')
  const [text, setText] = React.useState('')
  const [q, setQ] = React.useState({ kind, search: null as string | null, offset: 0 })
  const contacts = useOdooContacts(q)
  const data = contacts.data

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Read from Odoo: buyers, growers and the people under them, with their emails. Invoice emails go to a buyer's invoice addresses here. Add or change contacts in Odoo."
      />
      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <fieldset className="flex w-fit flex-wrap gap-1 rounded-md border border-input bg-card p-1">
            <legend className="sr-only">Show</legend>
            {KINDS.map((k) => (
              <label key={k.key} className={cn('inline-flex h-9 cursor-pointer items-center rounded px-3 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', kind === k.key && 'bg-accent/20')}>
                <input
                  type="radio"
                  name="contact-kind"
                  className="sr-only"
                  checked={kind === k.key}
                  onChange={() => {
                    setKind(k.key)
                    setQ({ ...q, kind: k.key, offset: 0 })
                  }}
                />
                {k.label}
              </label>
            ))}
          </fieldset>
          <form
            role="search"
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setQ({ kind, search: text.trim() || null, offset: 0 })
            }}
          >
            <label htmlFor="contact-search" className="sr-only">
              Name, email or company
            </label>
            <Input id="contact-search" type="search" placeholder="Name, email or company" value={text} onChange={(e) => setText(e.target.value)} className="w-64" />
            <Button type="submit" variant="outline">
              <Search aria-hidden="true" /> Search
            </Button>
          </form>
        </div>
        {contacts.isFetching && <Spinner />}
        {data?.error && (
          <Alert variant="warning" title="Couldn't read Odoo">
            {data.error} <Link to="/settings/odoo" className="font-semibold underline">Odoo settings</Link>
          </Alert>
        )}
        {data?.source === 'demo' && <p className="text-sm text-muted-foreground">Preview: these are the demo Odoo's contacts.</p>}
        {data && !data.error && !contacts.isFetching && (
          <>
            <p className="text-sm">
              {data.total} {data.total === 1 ? 'contact' : 'contacts'}
            </p>
            <Card>
              <Table>
                <caption className="sr-only">Contacts in Odoo</caption>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Email</TH>
                    <TH>Phone</TH>
                    <TH>Kind</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.contacts.map((c) => (
                    <TR key={c.id}>
                      <TD>
                        <span className={cn(c.is_company && 'font-semibold')}>{c.name}</span>
                        {c.job && <span className="block text-sm text-muted-foreground">{c.job}</span>}
                      </TD>
                      <TD>{c.is_company ? <span className="text-muted-foreground">Company{c.ref ? ` · ${c.ref}` : ''}</span> : c.company}</TD>
                      <TD className="break-all">
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="underline underline-offset-2">
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{c.phone ?? ''}</TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {TYPE[c.type] && <Badge variant={c.type === 'invoice' ? 'success' : 'default'}>{TYPE[c.type]}</Badge>}
                          {c.is_company && c.buyer && <Badge>Buyer</Badge>}
                          {c.is_company && c.grower && <Badge>Grower</Badge>}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {data.contacts.length === 0 && <p className="p-4 text-muted-foreground">No contacts in Odoo for this.</p>}
            </Card>
            {data.total > 50 && (
              <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
                <Button variant="outline" disabled={q.offset === 0} onClick={() => setQ({ ...q, offset: Math.max(0, q.offset - 50) })}>
                  <ChevronLeft aria-hidden="true" /> Previous
                </Button>
                <span className="text-sm">
                  {q.offset + 1}–{Math.min(q.offset + 50, data.total)} of {data.total}
                </span>
                <Button variant="outline" disabled={q.offset + 50 >= data.total} onClick={() => setQ({ ...q, offset: q.offset + 50 })}>
                  Next <ChevronRight aria-hidden="true" />
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  )
}
