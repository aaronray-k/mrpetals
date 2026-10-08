/**
 * The invoice email to a buyer: warm and cordial, in ConsolFlora's voice. Filled in from the invoice; the person
 * sending can edit it before it goes.
 */
/** ConsolFlora's bank details, with the account number for the invoice's currency. */
export interface BankForEmail {
  account_name: string
  bank_name: string
  bank_code: string | null
  branch: string | null
  swift_code: string | null
  account_number: string
}
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
  bank: BankForEmail | null
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
      lines.push(`  Account name: ${i.bank.account_name}`)
      lines.push(`  Bank: ${i.bank.bank_name}`)
      if (i.bank.bank_code) lines.push(`  Bank code: ${i.bank.bank_code}`)
      if (i.bank.branch) lines.push(`  Branch: ${i.bank.branch}`)
      if (i.bank.swift_code) lines.push(`  SWIFT code: ${i.bank.swift_code}`)
      lines.push(`  Account number (${i.currency}): ${i.bank.account_number}`)
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

/** Zoho's sign-in refusal, in words: what to check. */
export function explainMailError(message: string, s: { smtp_host: string | null; smtp_user: string | null; from_address: string | null }) {
  if (!/\b535\b|invalid login|authentication failed|EAUTH/i.test(message)) return message
  const other = s.smtp_host === 'smtppro.zoho.com' ? 'smtp.zoho.com' : s.smtp_host === 'smtp.zoho.com' ? 'smtppro.zoho.com' : null
  return [
    `The mail server refused the sign-in (${message.trim()}). Check, in this order:`,
    "1. The Zoho plan lets outside apps send mail (Zoho's free plan doesn't).",
    '2. SMTP_PASSWORD on Render is an app-specific password (Zoho: Security → App Passwords) if the mailbox uses two-factor sign-in.',
    other ? `3. The outgoing server: ${s.smtp_host} is for ${other === 'smtp.zoho.com' ? 'company-domain mailboxes on a paid plan' : 'personal and free accounts'}; try ${other}.` : '3. The outgoing server matches the account.',
    `4. SMTP user is the mailbox's own main address (now: ${s.smtp_user || s.from_address}), the one the password belongs to.`,
  ].join('\n')
}
