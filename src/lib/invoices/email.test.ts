import { describe, expect, it } from 'vitest'
import { greetingName, invoiceEmail, parseAddresses, type InvoiceEmailInput } from './email'

const base: InvoiceEmailInput = {
  contactName: 'Aiko Tanaka',
  companyName: 'Pacific Floral Japan GK',
  invoiceNumber: 'INV/2026/00089',
  amount: 11029.4,
  currency: 'USD',
  kind: 'invoice',
  dueDate: '2026-11-15',
  orderNumbers: ['CFLPFJ0089'],
  flight: 'EK 720',
  mawb: '176-61541003',
  bank: { account_name: 'CONSOLFLORA LIMITED', bank_name: 'NCBA Bank Kenya PLC', bank_code: '07000', branch: 'EMBAKASI', swift_code: 'CBAFKENX', account_number: '1006587104' },
  senderName: 'Grace Wanjiku',
  companyLegalName: 'Consolflora Limited',
}

describe('invoice email', () => {
  it('a warm message with the invoice, amount, due date, payment reference and bank account', () => {
    const { subject, body } = invoiceEmail(base)
    expect(subject).toBe('Your invoice INV/2026/00089 from Consolflora')
    expect(body).toContain('Dear Aiko,')
    expect(body).toContain('Please find attached our invoice INV/2026/00089 for US$11,029.40, together with the proforma invoice for your order CFLPFJ0089 (flight EK 720, MAWB 176-61541003).')
    expect(body).toContain('Payment is due by 15 November 2026. When you make the transfer, kindly quote INV/2026/00089 as the payment reference, to our USD account:')
    expect(body).toContain(
      ['  Account name: CONSOLFLORA LIMITED', '  Bank: NCBA Bank Kenya PLC', '  Bank code: 07000', '  Branch: EMBAKASI', '  SWIFT code: CBAFKENX', '  Account number (USD): 1006587104'].join('\n'),
    )
    expect(body.trimEnd().endsWith('Grace Wanjiku\nSales · Consolflora Limited')).toBe(true)
  })

  it('several orders, no bank account yet, no contact name', () => {
    const { body } = invoiceEmail({ ...base, contactName: null, orderNumbers: ['CFLPFJ0089', 'CFLPFJ0090', 'CFLPFJ0091'], bank: null, flight: null, mawb: null })
    expect(body).toContain('Dear Pacific Floral Japan GK,')
    expect(body).toContain('the proforma invoices for your orders CFLPFJ0089, CFLPFJ0090 and CFLPFJ0091.')
    expect(body).toContain('kindly quote INV/2026/00089 as the payment reference.')
    expect(body).not.toContain('Account number')
  })

  it('a credit note: no payment request', () => {
    const { subject, body } = invoiceEmail({ ...base, kind: 'credit_note', invoiceNumber: 'RINV/2026/00004', amount: 24.8, orderNumbers: [] })
    expect(subject).toBe('Your credit note RINV/2026/00004 from Consolflora')
    expect(body).toContain('our credit note RINV/2026/00004 for US$24.80. It will be set against your account with us.')
    expect(body).not.toContain('Payment is due')
  })

  it('greets by first name, else the company', () => {
    expect(greetingName(' Jan de Vries ', 'Bloem Handel BV')).toBe('Jan')
    expect(greetingName('', 'Bloem Handel BV')).toBe('Bloem Handel BV')
  })

  it('reads addresses separated by commas, semicolons or spaces, and flags bad ones', () => {
    expect(parseAddresses('a@x.jp, b@y.nl; a@x.jp  nope')).toEqual({ ok: ['a@x.jp', 'b@y.nl'], bad: ['nope'] })
  })
})
