-- Invoice emails: a confirmed invoice is emailed to the buyer from the sales mailbox, with Odoo's invoice PDF
-- and the proforma(s) attached, and the bank account for the invoice's currency in the message.
-- The mailbox password lives only in the app server's environment (SMTP_PASSWORD).

create table public.bank_accounts (
  currency text primary key,
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  branch text,
  swift_code text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id)
);
alter table public.bank_accounts enable row level security;
create policy "bank_accounts: invoicing read" on public.bank_accounts for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
create policy "bank_accounts: admin insert" on public.bank_accounts for insert to authenticated with check (public.has_role('admin'));
create policy "bank_accounts: admin update" on public.bank_accounts for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "bank_accounts: admin delete" on public.bank_accounts for delete to authenticated using (public.has_role('admin'));
create trigger bank_accounts_touch before update on public.bank_accounts for each row execute function public.touch_updated();

create table public.invoice_emails (
  id bigserial primary key,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid() references auth.users (id),
  to_addresses text[] not null,
  cc_addresses text[] not null default '{}',
  subject text not null,
  attachments text[] not null default '{}',
  ok boolean not null,
  error text
);
alter table public.invoice_emails enable row level security;
create policy "invoice_emails: invoicing read" on public.invoice_emails for select to authenticated using (public.is_staff() or public.is_finance_or_admin());

create or replace function public.record_invoice_email(p_invoice_id uuid, p_to text[], p_cc text[], p_subject text, p_attachments text[], p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_invoicing();
  insert into invoice_emails (invoice_id, to_addresses, cc_addresses, subject, attachments, ok, error)
  values (p_invoice_id, p_to, coalesce(p_cc, '{}'), left(p_subject, 300), coalesce(p_attachments, '{}'), p_ok, left(p_error, 500));
end;
$$;

-- What the app server needs to send as the sales mailbox (no password: that is in the server environment).
-- Mail settings are Admin-only to read; Finance and Consolidators send invoices too.
create or replace function public.mail_sender()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_staff() or public.is_finance_or_admin() then
    jsonb_build_object('enabled', enabled, 'from_name', from_name, 'from_address', from_address, 'smtp_host', smtp_host, 'smtp_port', smtp_port, 'smtp_user', smtp_user)
  end
  from mail_settings
$$;
