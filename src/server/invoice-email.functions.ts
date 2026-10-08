import { createServerFn } from '@tanstack/react-start'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { COMPANY } from '~/lib/company'
import { invoiceEmail, type BankForEmail } from '~/lib/invoices/email'
import type { BuyerRef, OrderCharge, PackingListRow, Shipment } from '~/lib/orders/api'
import type { ProformaInput } from '~/lib/orders/excel'
import { proformaPdf, proformaPdfName } from '~/lib/orders/proforma-pdf'
import { authMiddleware, requireRoles, type AuthContext } from './auth'
import { invoiceOdoo, readOdoo } from './odoo.functions'
import { defaultRecipients, type OdooContact } from './odoo/client'

/**
 * Invoice emails to buyers, from the sales mailbox (Email settings; the password is SMTP_PASSWORD in the
 * server environment). Odoo's invoice PDF and the proforma PDF(s) are attached.
 */
const ROLES = ['admin', 'consolidator', 'finance'] as const

interface Sender {
  enabled: boolean
  from_name: string | null
  from_address: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_user: string | null
}
async function sender(ctx: AuthContext): Promise<{ ok: true; s: Sender } | { ok: false; reason: string; s: Sender | null }> {
  const { data } = await ctx.supabase.rpc('mail_sender')
  const s = data as Sender | null
  if (!s) return { ok: false, reason: 'Email settings are missing.', s: null }
  if (!s.from_address || !s.smtp_host || !s.smtp_port) return { ok: false, reason: 'Fill in the sender address and outgoing server on Email settings.', s }
  if (!process.env.SMTP_PASSWORD) return { ok: false, reason: 'Add SMTP_PASSWORD (the sales mailbox password, or a Zoho app password) to the server environment.', s }
  if (!s.enabled) return { ok: false, reason: 'Sending email is switched off on Email settings.', s }
  return { ok: true, s }
}
async function transport(s: Sender) {
  const nodemailer = await import('nodemailer')
  return nodemailer.createTransport({
    host: s.smtp_host!,
    port: s.smtp_port!,
    secure: s.smtp_port === 465,
    auth: { user: s.smtp_user || s.from_address!, pass: process.env.SMTP_PASSWORD! },
  })
}
const fromHeader = (s: Sender) => ({ name: s.from_name || 'Consolflora', address: s.from_address! })

/** ConsolFlora's logo for the proforma, wherever the build put the public files. */
let logoCache: Uint8Array | null | undefined
function logo() {
  if (logoCache !== undefined) return logoCache
  const rel = 'labels/consolflora-logo-full.png'
  const found = [path.resolve('public', rel), path.resolve('dist/client', rel), path.resolve('../client', rel), path.resolve('client', rel)].find((p) => existsSync(p))
  logoCache = found ? new Uint8Array(readFileSync(found)) : null
  return logoCache
}

/** Everything a proforma needs for one order, read as the signed-in user. */
async function proformaInput(ctx: AuthContext, orderId: string): Promise<ProformaInput> {
  const sb = ctx.supabase
  const { data: o, error } = await sb.from('customer_orders').select('id, order_number, currency, farm_delivery_date, incoterm, customer_id, shipment_id').eq('id', orderId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!o) throw new Error('This order doesn\'t exist, or you may not see it.')
  const [buyer, shipment, rows, charges] = await Promise.all([
    sb.from('customers').select('id, customer_code, company_name, incoterm, currency, country, city, delivery_address, destination_airport').eq('id', o.customer_id).single(),
    o.shipment_id ? sb.from('shipments').select('*').eq('id', o.shipment_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb.from('order_packing_list').select('*').eq('order_id', orderId),
    sb.from('order_charges').select('*').eq('order_id', orderId).order('sort_order'),
  ])
  for (const r of [buyer, shipment, rows, charges]) if (r.error) throw new Error(r.error.message)
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    order: { order_number: o.order_number, currency: o.currency, farm_delivery_date: o.farm_delivery_date, incoterm: o.incoterm },
    buyer: buyer.data as BuyerRef,
    shipment: (shipment.data as Shipment | null) ?? null,
    rows: ((rows.data ?? []) as PackingListRow[]).map((r) => ({ ...r, margin_per_stem: n(r.margin_per_stem), grower_price_per_stem: n(r.grower_price_per_stem) })),
    charges: ((charges.data ?? []) as OrderCharge[]).map((c) => ({ ...c, amount: Number(c.amount) })),
    withPrices: true,
  }
}

/** The invoice, its buyer and orders, for the email. */
async function invoiceFacts(ctx: AuthContext, invoiceId: string) {
  const sb = ctx.supabase
  const { data: i, error } = await sb
    .from('invoices')
    .select('id, kind, status, odoo_state, odoo_name, amount, currency, odoo_due_date, order_ids, shipment_id, mawb, flight, customers(company_name, customer_code, odoo_partner_id, contact_name, contact_email)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!i) throw new Error('This invoice doesn\'t exist, or you may not see it.')
  const [orders, shipment, details, account, me] = await Promise.all([
    (i.order_ids as string[]).length ? sb.from('customer_orders').select('id, order_number').in('id', i.order_ids as string[]).order('order_number') : Promise.resolve({ data: [], error: null }),
    i.shipment_id ? sb.from('shipments').select('flight_no, mawb').eq('id', i.shipment_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    sb.from('bank_details').select('account_name, bank_name, bank_code, branch, swift_code').maybeSingle(),
    sb.from('bank_accounts').select('account_number').eq('currency', i.currency).maybeSingle(),
    sb.from('profiles').select('full_name').eq('id', ctx.user.id).maybeSingle(),
  ])
  const customer = (Array.isArray(i.customers) ? i.customers[0] : i.customers) as { company_name: string; customer_code: string; odoo_partner_id: number | null; contact_name: string | null; contact_email: string } | null
  return {
    i,
    customer,
    orders: (orders.data ?? []) as { id: string; order_number: string }[],
    flight: (i.flight as string | null) ?? (shipment.data as { flight_no: string | null } | null)?.flight_no ?? null,
    mawb: (i.mawb as string | null) ?? (shipment.data as { mawb: string | null } | null)?.mawb ?? null,
    // The shared bank details, with the account number for this invoice's currency.
    bank: details.data && account.data ? ({ ...details.data, account_number: (account.data as { account_number: string }).account_number } as BankForEmail) : null,
    senderName: (me.data as { full_name: string | null } | null)?.full_name?.trim() || ctx.user.email || 'Consolflora',
  }
}

export const getInvoiceEmailDraft = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ invoiceId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const f = await invoiceFacts(context, data.invoiceId)
    const number = f.i.odoo_name && f.i.odoo_name !== '/' ? (f.i.odoo_name as string) : ''
    const draft = invoiceEmail({
      contactName: f.customer?.contact_name ?? null,
      companyName: f.customer?.company_name ?? '',
      invoiceNumber: number,
      amount: Number(f.i.amount),
      currency: f.i.currency as string,
      kind: f.i.kind as 'invoice' | 'credit_note',
      dueDate: (f.i.odoo_due_date as string | null) ?? null,
      orderNumbers: f.orders.map((o) => o.order_number),
      flight: f.flight,
      mawb: f.mawb,
      bank: f.bank,
      senderName: f.senderName,
      companyLegalName: COMPANY.name,
    })
    const mail = await sender(context)
    // The buyer's contacts in Odoo: who it goes to by default, and everyone else to pick from.
    let contacts: OdooContact[] = []
    let contactsError: string | null = null
    if (f.customer) {
      const r = await readOdoo(context)
      if (r.odoo) {
        try {
          contacts = (await r.odoo.contactsOf({ odoo_partner_id: f.customer.odoo_partner_id, code: f.customer.customer_code })).filter((c) => c.email)
        } catch (e) {
          contactsError = (e as Error).message
        }
      } else contactsError = r.reason
    }
    return {
      confirmed: f.i.status === 'pushed' && f.i.odoo_state === 'posted',
      to: defaultRecipients(contacts, f.customer?.contact_email ?? null).join(', '),
      contacts,
      contactsError,
      ...draft,
      invoiceFile: `${number.replace(/\//g, '_') || 'Invoice'}.pdf`,
      proformas: f.orders.map((o) => ({ orderId: o.id, orderNumber: o.order_number })),
      bankMissing: !f.bank && f.i.kind === 'invoice',
      mail: { ready: mail.ok, reason: mail.ok ? null : mail.reason, from: mail.s?.from_address ?? null },
    }
  })

export const downloadProformaPdf = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const input = await proformaInput(context, data.orderId)
    return { name: proformaPdfName(input, true), base64: Buffer.from(await proformaPdf(input, logo(), { packingList: true })).toString('base64') }
  })

const email = z.string().trim().email().max(200)
export const sendInvoiceEmail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      invoiceId: z.string().uuid(),
      to: z.array(email).min(1).max(10),
      cc: z.array(email).max(10),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20_000),
      attachInvoice: z.boolean(),
      orderIds: z.array(z.string().uuid()).max(20),
    }),
  )
  .handler(async ({ data, context }) => {
    requireRoles(context, [...ROLES])
    const mail = await sender(context)
    if (!mail.ok) return { ok: false as const, message: `Not sent: ${mail.reason}` }
    const f = await invoiceFacts(context, data.invoiceId)
    if (f.i.status !== 'pushed' || f.i.odoo_state !== 'posted') return { ok: false as const, message: 'Confirm the invoice before emailing it.' }
    const record = (ok: boolean, names: string[], error?: string) =>
      context.supabase.rpc('record_invoice_email', { p_invoice_id: data.invoiceId, p_to: data.to, p_cc: data.cc, p_subject: data.subject, p_attachments: names, p_ok: ok, p_error: error ?? null })

    const attachments: { filename: string; content: Buffer; contentType: string }[] = []
    try {
      if (data.attachInvoice) {
        const { odoo, moveId, reason } = await invoiceOdoo(context, data.invoiceId)
        if (!odoo || !moveId) throw new Error(reason ?? 'Odoo is not connected.')
        let pdf = await odoo.movePdf(moveId)
        if (!pdf) {
          await odoo.makePdf(moveId)
          pdf = await odoo.movePdf(moveId)
        }
        if (!pdf) throw new Error("Odoo's invoice PDF isn't available. Make it on the invoice page first, or untick it.")
        attachments.push({ filename: pdf.name.toLowerCase().endsWith('.pdf') ? pdf.name : `${pdf.name}.pdf`, content: Buffer.from(pdf.base64, 'base64'), contentType: 'application/pdf' })
      }
      const allowed = new Set(f.orders.map((o) => o.id))
      for (const id of data.orderIds) {
        if (!allowed.has(id)) throw new Error('A proforma chosen is not for an order on this invoice.')
        const input = await proformaInput(context, id)
        attachments.push({ filename: proformaPdfName(input, true), content: Buffer.from(await proformaPdf(input, logo(), { packingList: true })), contentType: 'application/pdf' })
      }
    } catch (e) {
      await record(false, attachments.map((a) => a.filename), (e as Error).message)
      return { ok: false as const, message: `Not sent: ${(e as Error).message}` }
    }
    const names = attachments.map((a) => a.filename)
    try {
      const t = await transport(mail.s)
      await t.sendMail({ from: fromHeader(mail.s), replyTo: mail.s.from_address!, to: data.to, cc: data.cc.length ? data.cc : undefined, subject: data.subject, text: data.body, attachments })
      await record(true, names)
      return { ok: true as const, message: `Sent to ${data.to.join(', ')}${names.length ? ` with ${names.join(', ')}` : ''}.` }
    } catch (e) {
      const message = (e as Error).message
      await record(false, names, message)
      return { ok: false as const, message: `Not sent: ${message}` }
    }
  })

/** Email settings: a test email to the Admin's own address, to check the sales mailbox works. */
export const sendTestEmail = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireRoles(context, ['admin'])
    const mail = await sender(context)
    if (!mail.ok) return { ok: false, message: mail.reason }
    if (!context.user.email) return { ok: false, message: 'Your account has no email address.' }
    try {
      const t = await transport(mail.s)
      await t.verify()
      await t.sendMail({
        from: fromHeader(mail.s),
        to: context.user.email,
        subject: 'Consolflora: test email',
        text: `This is a test from Consolflora's Email settings.\n\nIf you can read this, invoice emails will go out from ${mail.s.from_address}.`,
      })
      return { ok: true, message: `Sent a test email to ${context.user.email} from ${mail.s.from_address}.` }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })
