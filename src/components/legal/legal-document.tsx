import type { LegalDocument } from '~/lib/legal/documents'
import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'

/** "Pending legal review": the documents are placeholders until a lawyer has reviewed them. */
export function PendingReview() {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-md bg-warning-bg px-2 py-1 text-sm font-semibold text-warning">
      <AlertTriangle className="size-4" aria-hidden="true" /> Pending legal review: placeholder text
    </p>
  )
}

/** The document's sections. `headingLevel` keeps the outline right wherever it is shown. */
export function LegalDocumentBody({ doc, headingLevel = 2 }: { doc: LegalDocument; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className="grid gap-5">
      {doc.sections.map((s) => (
        <section key={s.heading} className="grid gap-2">
          <H className="text-lg font-bold">{s.heading}</H>
          {s.body.map((b, i) =>
            Array.isArray(b) ? (
              <ul key={i} className="grid list-disc gap-1 pl-6">
                {b.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>{b}</p>
            ),
          )}
        </section>
      ))}
      {doc.code === 'terms-of-sale' && (
        <p>
          Read the{' '}
          <Link to="/legal/$code" params={{ code: 'claims' }} target="_blank" className="font-semibold underline">
            Claims and credits policy (opens in a new tab)
          </Link>
          , which forms part of these terms.
        </p>
      )}
      <p className="text-sm text-muted-foreground">Version {doc.version}</p>
    </div>
  )
}
