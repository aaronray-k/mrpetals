import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, CheckCircle2 } from 'lucide-react'
import { getSupabase } from '~/lib/supabase'
import { useAuth } from '~/lib/auth'
import { hasAnyRole } from '~/lib/roles'
import { legalDocument } from '~/lib/legal/documents'
import { LegalDocumentBody, PendingReview } from '~/components/legal/legal-document'
import { LegalFooter } from '~/components/legal/legal-footer'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'

interface PendingDoc {
  code: string
  title: string
  version: string
}

export function usePendingDocuments(userId: string | undefined) {
  return useQuery({
    queryKey: ['legal-pending', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('my_pending_documents')
      if (error) throw new Error(error.message)
      return (data ?? []) as PendingDoc[]
    },
    staleTime: Infinity,
  })
}

/**
 * Before anything else: the person reads and accepts the documents for their role. Each document is
 * in its own scroll box; its tick box unlocks once they have scrolled to the end. The database
 * refuses access until the current versions are accepted, so this can't be skipped.
 */
export function LegalGate({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const pending = usePendingDocuments(session?.user.id)
  if (pending.isLoading) return <Spinner className="m-8" />
  if (pending.error) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <Alert variant="destructive" title="Couldn't check your agreements" role="alert">
          {(pending.error as Error).message}
        </Alert>
      </main>
    )
  }
  if (!pending.data?.length) return <>{children}</>
  return <ConsentStep docs={pending.data} />
}

function ConsentStep({ docs }: { docs: PendingDoc[] }) {
  const { roles, signOut, session } = useAuth()
  const queryClient = useQueryClient()
  const [accepted, setAccepted] = React.useState<Record<string, boolean>>({})
  const [marketing, setMarketing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const offerMarketing = hasAnyRole(roles, ['customer', 'farm'])
  const allTicked = docs.every((d) => accepted[d.code])
  const outdated = docs.filter((d) => legalDocument(d.code)?.version !== d.version)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!allTicked) return setError('Read each document to the end and tick to agree.')
    setBusy(true)
    setError(null)
    const { error } = await getSupabase().rpc('accept_documents', {
      p_documents: docs.map((d) => ({ code: d.code, version: d.version })),
      p_marketing: offerMarketing ? marketing : null,
      p_user_agent: navigator.userAgent,
    })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    await queryClient.invalidateQueries({ queryKey: ['legal-pending', session?.user.id] })
  }

  return (
    <div className="min-h-dvh bg-sidebar">
      <main id="main" className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
        <img src="/consolflora-logo-dark.png" alt="ConsolFlora" width={180} height={73} className="h-auto w-[180px]" />
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-bold leading-tight">Before you start</h1>
            <CardDescription>
              Please read {docs.length === 1 ? 'this document' : `these ${docs.length} documents`} to the end and tick to agree. You can use ConsolFlora
              once you have agreed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="grid gap-6">
              {error && <Alert variant="destructive" title={error} role="alert" />}
              {outdated.length > 0 && (
                <Alert variant="destructive" title="This page is out of date" role="alert">
                  Reload the page to read the current version of {outdated.map((d) => d.title).join(' and ')}.
                </Alert>
              )}
              {docs.map((d) => (
                <DocumentToAccept key={d.code} pending={d} checked={!!accepted[d.code]} onChange={(on) => setAccepted((a) => ({ ...a, [d.code]: on }))} />
              ))}
              {offerMarketing && (
                <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-accent" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Optional:</span> send me news and offers from ConsolFlora by email. You can change this at any time
                    in My account.
                  </span>
                </label>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="link" onClick={() => void signOut()}>
                  Sign out
                </Button>
                <Button type="submit" size="lg" disabled={busy || !allTicked || outdated.length > 0}>
                  {busy ? 'Saving…' : 'Agree and continue'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <LegalFooter dark />
      </main>
    </div>
  )
}

function DocumentToAccept({ pending, checked, onChange }: { pending: PendingDoc; checked: boolean; onChange: (on: boolean) => void }) {
  const doc = legalDocument(pending.code)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const endRef = React.useRef<HTMLDivElement>(null)
  const [read, setRead] = React.useState(false)
  const id = `legal-${pending.code}`

  React.useEffect(() => {
    const box = boxRef.current
    const end = endRef.current
    if (!box || !end) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setRead(true), { root: box, threshold: 1 })
    io.observe(end)
    return () => io.disconnect()
  }, [])

  if (!doc) return <Alert variant="destructive" title={`${pending.title} is missing from this version of the app.`} />
  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-xl font-bold">
          {doc.title}
        </h2>
        <PendingReview />
      </div>
      <div
        ref={boxRef}
        id={`${id}-text`}
        tabIndex={0}
        role="region"
        aria-label={`${doc.title}, scroll to read`}
        className="max-h-[50vh] overflow-y-auto rounded-md border bg-background p-4 leading-relaxed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <LegalDocumentBody doc={doc} headingLevel={3} />
        <div ref={endRef} className="h-px" aria-hidden="true" />
      </div>
      <p id={`${id}-hint`} className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
        {read ? (
          <>
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> You've reached the end. You can now tick to agree.
          </>
        ) : (
          <>
            <ArrowDown className="size-4" aria-hidden="true" /> Scroll to the end of the {doc.title} to agree.
          </>
        )}
      </p>
      <label className={`flex items-start gap-3 rounded-md border p-3 ${read ? 'cursor-pointer' : 'opacity-70'}`}>
        <input
          type="checkbox"
          className="mt-0.5 size-6 shrink-0 accent-accent"
          checked={checked}
          disabled={!read}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="font-semibold">
          {doc.code === 'privacy' || doc.code === 'cookies' ? `I have read the ${doc.title}` : `I have read and agree to the ${doc.title}`}
          {doc.code === 'terms-of-sale' ? ', including the Claims and credits policy' : ''}
        </span>
      </label>
    </section>
  )
}
