/**
 * The invoice email to a buyer: warm and cordial, in ConsolFlora's voice. Filled in from the invoice; the person
 * sending can edit it before it goes.
 */
export interface InvoiceEmailInput {
  /** The buyer's contact person; the company name is used when there is none. */
  contactName: string | null
  companyName: string
  invoiceNumber: string
  amount: number
  currency: string
  kind: 'invoice' | 'credit_note'
  dueDate: string | null
  orderNumbers: string[]
  flight: string | null
  mawb: string | null
  bank: { bank_name: string; account_name: string; account_number: string; branch: string | null; swift_code: string | null } | null
  senderName: string
  companyLegalName: string
}

const money = (n: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n)
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "Aiko" from "Aiko Tanaka"; the company name when there is no contact. */
export function greetingName(contactName: string | null, companyName: string) {
  const first = contactName?.trim().split(/\s+/)[0]
  return first || companyName
}

export function invoiceEmail(i: InvoiceEmailInput): { subject: string; body: string } {
  const amount = money(i.amount, i.currency)
  const credit = i.kind === 'credit_note'
  const subject = credit ? `Your credit note ${i.invoiceNumber} from Consolflora` : `Your invoice ${i.invoiceNumber} from Consolflora`
  const shipment = [i.flight && `flight ${i.flight}`, i.mawb && `MAWB ${i.mawb}`].filter(Boolean).join(', ')
  const orders = i.orderNumbers.length
    ? `, together with the proforma invoice${i.orderNumbers.length > 1 ? 's' : ''} for your order${i.orderNumbers.length > 1 ? 's' : ''} ${list(i.orderNumbers)}${shipment ? ` (${shipment})` : ''}`
    : ''
  const lines = [`Dear ${greetingName(i.contactName, i.companyName)},`, '', 'Warm greetings from Nairobi, and thank you for your continued trust in Consolflora.', '']
  if (credit) {
    lines.push(`Please find attached our credit note ${i.invoiceNumber} for ${amount}${orders}. It will be set against your account with us.`)
  } else {
    lines.push(`Please find attached our invoice ${i.invoiceNumber} for ${amount}${orders}.`, '')
    const due = i.dueDate ? `Payment is due by ${day(i.dueDate)}. ` : ''
    if (i.bank) {
      lines.push(`${due}When you make the transfer, kindly quote ${i.invoiceNumber} as the payment reference, to our ${i.currency} account:`, '')
      lines.push(`  Bank: ${i.bank.bank_name}${i.bank.branch ? `, ${i.bank.branch}` : ''}`)
      lines.push(`  Account name: ${i.bank.account_name}`)
      lines.push(`  Account number: ${i.bank.account_number}`)
      if (i.bank.swift_code) lines.push(`  SWIFT: ${i.bank.swift_code}`)
    } else {
      lines.push(`${due}When you make the transfer, kindly quote ${i.invoiceNumber} as the payment reference.`)
    }
  }
  lines.push('', "If anything needs a second look, just reply to this email and we'll gladly help.", '', 'With warm regards,', '', i.senderName, `Sales · ${i.companyLegalName}`)
  return { subject, body: lines.join('\n') }
}

/** Addresses typed into To or Cc: separated by commas, semicolons or spaces. */
export function parseAddresses(s: string): { ok: string[]; bad: string[] } {
  const parts = s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)
  const ok = parts.filter((x) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(x))
  return { ok: [...new Set(ok)], bad: parts.filter((x) => !ok.includes(x)) }
}
