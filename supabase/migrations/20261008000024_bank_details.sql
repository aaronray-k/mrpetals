-- ConsolFlora has one bank and one set of bank details; only the account number differs by currency.
-- The shared details live once in bank_details; bank_accounts keeps the account number per currency.

create table public.bank_details (
  id boolean primary key default true check (id),
  account_name text not null,
  bank_name text not null,
  bank_code text,
  branch text,
  swift_code text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id)
);
alter table public.bank_details enable row level security;
create policy "bank_details: invoicing read" on public.bank_details for select to authenticated using (public.is_staff() or public.is_finance_or_admin());
create policy "bank_details: admin insert" on public.bank_details for insert to authenticated with check (public.has_role('admin'));
create policy "bank_details: admin update" on public.bank_details for update to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create trigger bank_details_touch before update on public.bank_details for each row execute function public.touch_updated();

-- Details already typed on Email settings carry over; otherwise ConsolFlora's NCBA account.
insert into public.bank_details (account_name, bank_name, branch, swift_code)
select account_name, bank_name, branch, swift_code from public.bank_accounts order by currency limit 1;
insert into public.bank_details (account_name, bank_name, bank_code, branch, swift_code)
values ('CONSOLFLORA LIMITED', 'NCBA Bank Kenya PLC', '07000', 'EMBAKASI', 'CBAFKENX')
on conflict (id) do nothing;

alter table public.bank_accounts
  drop column bank_name,
  drop column account_name,
  drop column branch,
  drop column swift_code;
insert into public.bank_accounts (currency, account_number) values
  ('KES', '1006586988'), ('USD', '1006587104'), ('EUR', '1006587214')
on conflict (currency) do nothing;
