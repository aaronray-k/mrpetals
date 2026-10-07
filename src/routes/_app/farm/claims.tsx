import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, MessageCircleQuestion } from 'lucide-react'
import { farmSendCreditNote, noticeMessage, openCreditNoteDocument, useFarmNotices, useNoticePhotos, type Notice } from '~/lib/claims/api'
import { formatDateTime } from '~/lib/utils'
import { PageHeader } from '~/components/layout/app-shell'
import { RequireRole } from '~/components/layout/require-role'
import { rolesFor } from '~/components/layout/nav'
import { NoticeStatusBadge, PhotoGrid } from '~/components/claims/claim-parts'
import { money } from '~/components/shop/money'
import { Tip } from '~/components/tips/tips'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useToast } from '~/components/ui/toaster'

export const Route = createFileRoute('/_app/farm/claims')({
  head: () => ({ meta: [{ title: 'Claims on your flowers · ConsolFlora' }] }),
  component: () => (
    <RequireRole roles={rolesFor('/farm/claims')}>
      <FarmClaims />
    </RequireRole>
  ),
})

function FarmClaims() {
  const notices = useFarmNotices()
  return (
    <>
      <PageHeader title="Claims on your flowers" description="Buyer claims ConsolFlora approved on your boxes. Reply with your credit note, or ask a question." />
      <div className="grid grid-cols-1 gap-4">
        <Tip id="farm.claims" title="Claim notices">
          Each notice lists your boxes, the reason, the stems and the amount at your price, with the buyer's photos. Send your credit note
          (number, amount, date and the document), or ask ConsolFlora a question first. See the Supplier terms for how claims work.
        </Tip>
        {notices.isLoading && <Spinner />}
        {notices.error && <Alert variant="destructive" title="Couldn't load claim notices" role="alert">{(notices.error as Error).message}</Alert>}
        {notices.data?.length === 0 && <p className="text-muted-foreground">No claims on your flowers.</p>}
        {notices.data?.map((n) => <FarmNotice key={n.id} notice={n} />)}
      </div>
    </>
  )
}

function FarmNotice({ notice }: { notice: Notice }) {
  const photos = useNoticePhotos(notice)
  const toast = useToast()
  const queryClient = useQueryClient()
  const [number, setNumber] = React.useState('')
  const [amount, setAmount] = React.useState(notice.amount.toFixed(2))
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [file, setFile] = React.useState<File | null>(null)
  const [comment, setComment] = React.useState('')
  const [question, setQuestion] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const open = notice.status === 'sent' || notice.status === 'queried'
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['farm-notices'] })

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Claim notice {notice.notice_number}</CardTitle>
          <NoticeStatusBadge status={notice.status} />
        </div>
        <CardDescription>
          Sent {formatDateTime(notice.sent_at)} · <strong>{money(notice.amount, notice.currency)}</strong> to credit
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid gap-3">
          {notice.farm_claim_notice_lines.map((l) => (
            <li key={l.id} className="grid gap-2 rounded-md border p-3">
              <p>
                {l.box_id ? (
                  <>
                    <strong>Box {String(l.box_id).padStart(8, '0')}</strong> · {l.po_number} ·{' '}
                  </>
                ) : (
                  <strong>{l.product} · </strong>
                )}
                {l.box_id ? `${l.product} · ` : ''}
                {l.reason}
              </p>
              <p className="text-sm">
                {l.stems ? `${l.stems} stems × ${money(l.price_per_stem ?? 0, notice.currency, 3)} = ` : ''}
                <strong>{money(l.amount, notice.currency)}</strong>
              </p>
              {l.claim_line_id && <PhotoGrid photos={(photos.data ?? []).filter((p) => p.claim_line_id === l.claim_line_id)} label={`Buyer's photos of box ${l.box_id}`} />}
            </li>
          ))}
        </ul>

        {notice.farm_claim_messages.length > 0 && (
          <ul className="grid gap-2" aria-label="Messages">
            {notice.farm_claim_messages.map((m) => (
              <li key={m.id} className={`rounded-md p-2 text-sm ${m.author_side === 'farm' ? 'border' : 'bg-muted'}`}>
                <strong>{m.author_side === 'farm' ? 'You' : 'ConsolFlora'}</strong> · {formatDateTime(m.created_at)}
                <p>{m.body}</p>
              </li>
            ))}
          </ul>
        )}

        {notice.credit_note_number && (
          <Alert variant="success" title={`Your credit note ${notice.credit_note_number}: ${money(notice.credit_amount ?? 0, notice.currency)}`}>
            Issued {notice.credit_issued_on}.{' '}
            {notice.credit_document_path && (
              <Button variant="link" className="h-auto p-0" onClick={() => openCreditNoteDocument(notice.credit_document_path!).catch((e) => toast({ kind: 'error', title: (e as Error).message }))}>
                Open the document
              </Button>
            )}
          </Alert>
        )}

        {open && (
          <>
            <form
              noValidate
              className="grid gap-3 rounded-md border p-3"
              onSubmit={async (e) => {
                e.preventDefault()
                const n = Number(amount)
                if (number.trim().length < 2) return toast({ kind: 'error', title: 'Give your credit note number' })
                if (!(n > 0)) return toast({ kind: 'error', title: 'Give the credit note amount' })
                setBusy(true)
                try {
                  await farmSendCreditNote(notice, { number, amount: n, issuedOn: date, file, comment })
                  toast({ kind: 'success', title: 'Credit note sent to ConsolFlora' })
                  refresh()
                } catch (err) {
                  toast({ kind: 'error', title: 'Not sent', description: (err as Error).message })
                } finally {
                  setBusy(false)
                }
              }}
            >
              <h3 className="font-semibold">Send your credit note</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id={`cn-${notice.id}`} label="Credit note number">
                  {(d) => <Input id={`cn-${notice.id}`} value={number} onChange={(e) => setNumber(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id={`ca-${notice.id}`} label={`Amount (${notice.currency})`}>
                  {(d) => <Input id={`ca-${notice.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby={d} />}
                </Field>
                <Field id={`cd-${notice.id}`} label="Date issued">
                  {(d) => <Input id={`cd-${notice.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-describedby={d} />}
                </Field>
              </div>
              <Field id={`cf-${notice.id}`} label="The credit note document (PDF or photo, optional)">
                {(d) => <Input id={`cf-${notice.id}`} type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-describedby={d} />}
              </Field>
              <Field id={`cc-${notice.id}`} label="Comment (optional)">
                {(d) => <Input id={`cc-${notice.id}`} value={comment} onChange={(e) => setComment(e.target.value)} aria-describedby={d} />}
              </Field>
              <Button type="submit" disabled={busy} className="justify-self-start">
                <FileUp aria-hidden="true" /> {busy ? 'Sending…' : 'Send credit note'}
              </Button>
            </form>
            <div className="flex flex-wrap items-end gap-2">
              <Field id={`q-${notice.id}`} label="Or ask ConsolFlora a question">
                {(d) => <Input id={`q-${notice.id}`} value={question} onChange={(e) => setQuestion(e.target.value)} aria-describedby={d} className="sm:w-96" />}
              </Field>
              <Button
                variant="outline"
                disabled={question.trim().length < 2}
                onClick={async () => {
                  try {
                    await noticeMessage(notice.id, question)
                    setQuestion('')
                    toast({ kind: 'success', title: 'Question sent' })
                    refresh()
                  } catch (err) {
                    toast({ kind: 'error', title: 'Not sent', description: (err as Error).message })
                  }
                }}
              >
                <MessageCircleQuestion aria-hidden="true" /> Ask
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
