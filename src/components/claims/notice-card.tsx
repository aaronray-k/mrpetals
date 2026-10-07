import * as React from 'react'
import { Check, Send } from 'lucide-react'
import { closeNotice, noticeMessage, openCreditNoteDocument, type Notice } from '~/lib/claims/api'
import { formatDateTime } from '~/lib/utils'
import { NoticeStatusBadge } from '~/components/claims/claim-parts'
import { money } from '~/components/shop/money'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Field, Input } from '~/components/ui/input'
import { useToast } from '~/components/ui/toaster'

/** The claim notice sent to one farm: lines at the farm's price, its credit note, and messages. */
export function NoticeCard({ notice, canAct, onDone }: { notice: Notice; canAct: boolean; onDone: () => void }) {
  const toast = useToast()
  const [msg, setMsg] = React.useState('')
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Claim notice {notice.notice_number} · {notice.farms?.farm_name}
          </CardTitle>
          <NoticeStatusBadge status={notice.status} />
        </div>
        <CardDescription>
          Sent {formatDateTime(notice.sent_at)} · asked {money(notice.amount, notice.currency)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1 text-sm">
          {notice.farm_claim_notice_lines.map((l) => (
            <li key={l.id}>
              {l.box_id ? `Box ${String(l.box_id).padStart(8, '0')} · ${l.po_number} · ` : ''}
              {l.product} · {l.reason}
              {l.stems ? ` · ${l.stems} stems × ${money(l.price_per_stem ?? 0, notice.currency, 3)}` : ''} = <strong>{money(l.amount, notice.currency)}</strong>
            </li>
          ))}
        </ul>
        {notice.credit_note_number && (
          <Alert variant={notice.credit_amount != null && notice.credit_amount < notice.amount ? 'warning' : 'success'} title={`Farm credit note ${notice.credit_note_number}: ${money(notice.credit_amount ?? 0, notice.currency)}`}>
            Issued {notice.credit_issued_on}
            {notice.credit_amount != null && notice.credit_amount < notice.amount ? `, less than the ${money(notice.amount, notice.currency)} asked.` : '.'}{' '}
            {notice.credit_document_path && (
              <Button variant="link" className="h-auto p-0" onClick={() => openCreditNoteDocument(notice.credit_document_path!).catch((e) => toast({ kind: 'error', title: (e as Error).message }))}>
                Open the document
              </Button>
            )}
          </Alert>
        )}
        {notice.farm_claim_messages.length > 0 && (
          <ul className="grid gap-2" aria-label="Messages">
            {notice.farm_claim_messages.map((m) => (
              <li key={m.id} className={`rounded-md p-2 text-sm ${m.author_side === 'farm' ? 'bg-muted' : 'border'}`}>
                <strong>{m.author_side === 'farm' ? notice.farms?.farm_name ?? 'Farm' : 'ConsolFlora'}</strong> · {formatDateTime(m.created_at)}
                <p>{m.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canAct && notice.status !== 'closed' && (
          <div className="flex flex-wrap items-end gap-2">
            <Field id={`msg-${notice.id}`} label="Message to the farm">
              {(d) => <Input id={`msg-${notice.id}`} value={msg} onChange={(e) => setMsg(e.target.value)} aria-describedby={d} className="sm:w-96" />}
            </Field>
            <Button
              variant="outline"
              disabled={msg.trim().length < 2}
              onClick={async () => {
                try {
                  await noticeMessage(notice.id, msg)
                  setMsg('')
                  onDone()
                } catch (e) {
                  toast({ kind: 'error', title: 'Not sent', description: (e as Error).message })
                }
              }}
            >
              <Send aria-hidden="true" /> Send
            </Button>
            {notice.status === 'credited' && (
              <Button
                onClick={async () => {
                  try {
                    await closeNotice(notice.id, msg)
                    setMsg('')
                    toast({ kind: 'success', title: `${notice.notice_number} closed` })
                    onDone()
                  } catch (e) {
                    toast({ kind: 'error', title: 'Not closed', description: (e as Error).message })
                  }
                }}
              >
                <Check aria-hidden="true" /> Close notice
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
