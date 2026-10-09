import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { legalDocument } from '~/lib/legal/documents'
import { LegalDocumentBody, PendingReview } from '~/components/legal/legal-document'
import { LegalFooter } from '~/components/legal/legal-footer'

// Public: anyone can read the legal documents without signing in.
export const Route = createFileRoute('/legal/$code')({
  loader: ({ params }) => {
    const doc = legalDocument(params.code)
    if (!doc) throw notFound()
    return doc
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.title ?? 'Legal'} · ConsolFlora` }] }),
  component: LegalPage,
  notFoundComponent: () => (
    <main className="mx-auto grid max-w-3xl gap-4 p-6">
      <h1 className="text-2xl font-bold">This page doesn't exist</h1>
      <Link to="/legal" className="font-semibold underline">
        See all legal documents
      </Link>
    </main>
  ),
})

function LegalPage() {
  const doc = Route.useLoaderData()
  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-sidebar px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link to="/sign-in" aria-label="ConsolFlora home">
            <img src="/consolflora-logo-dark.png" alt="ConsolFlora" width={120} height={49} className="h-auto w-[120px]" />
          </Link>
          <Link to="/legal" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-sidebar-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" /> All legal documents
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
        <div className="grid gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-primary dark:text-foreground">{doc.title}</h1>
          <p className="text-muted-foreground">
            For: {doc.audience}. {doc.summary}
          </p>
          <PendingReview />
        </div>
        <article className="rounded-lg border bg-card p-5 leading-relaxed">
          <LegalDocumentBody doc={doc} />
        </article>
        <LegalFooter className="border-t pt-4" />
      </main>
    </div>
  )
}
