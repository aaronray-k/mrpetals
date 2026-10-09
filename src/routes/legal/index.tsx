import { Link, createFileRoute } from '@tanstack/react-router'
import { LEGAL_DOCUMENTS } from '~/lib/legal/documents'
import { PendingReview } from '~/components/legal/legal-document'
import { LegalFooter } from '~/components/legal/legal-footer'

export const Route = createFileRoute('/legal/')({
  head: () => ({ meta: [{ title: 'Legal · ConsolFlora' }] }),
  component: LegalIndex,
})

function LegalIndex() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-sidebar px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <img src="/consolflora-logo-dark.png" alt="ConsolFlora" width={120} height={49} className="h-auto w-[120px]" />
          <Link to="/sign-in" className="inline-flex min-h-10 items-center text-sm font-semibold text-sidebar-foreground">
            Sign in
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight text-primary dark:text-foreground">Legal documents</h1>
        <PendingReview />
        <ul className="grid gap-3">
          {LEGAL_DOCUMENTS.map((d) => (
            <li key={d.code}>
              <Link to="/legal/$code" params={{ code: d.code }} className="grid gap-1 rounded-lg border bg-card p-4 hover:bg-muted">
                <span className="font-bold">{d.title}</span>
                <span className="text-sm text-muted-foreground">
                  For: {d.audience}. {d.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <LegalFooter className="border-t pt-4" />
      </main>
    </div>
  )
}
