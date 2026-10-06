# ConsolFlora

Flower consolidation and export management: farms, buyers, products, pack rates, prices, freight and
packing lists, with role-based access for Admin, Consolidator, Customer, Farm, QC and Finance.

**Stack:** React 19 · TanStack Start / Router · Tailwind CSS v4 · shadcn/ui-style components ·
self-hosted Supabase (Postgres + row level security) · Odoo 19 for accounting (later items).

## Getting started

Requirements: Node.js 22+, a self-hosted Supabase instance.

```bash
npm install
cp .env.example .env          # set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                   # http://localhost:3000
```

Apply the database migrations in `supabase/migrations` in file-name order, for example with the
Supabase CLI (`supabase db push --db-url ...`) or `psql -f`. Then make yourself the first Admin
(see [docs/backend.md](docs/backend.md)).

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Unit tests (dry-run rules, template check) |
| `npm run test:db` | Database tests: migrations, import function, RLS ([details](supabase/tests/run.sh)) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` |
| `npm start` | Serve the production build (Node, via srvx) |

`VITE_*` variables are built into the browser bundle, so set them before `npm run build`.

## Roles

Roles live in `public.user_roles`; RLS policies call `has_role()`, `is_staff()` (Admin or
Consolidator), `my_farm_id()` and `my_customer_id()`. The UI hides pages a role can't use, but the
data is always protected by RLS, never by the UI alone. Farm and Customer users only see rows for
the farm or customer linked on their profile.

## Navigation tips

Every menu item has a one-line hint, and pages show "Tip" boxes. Users switch all of them off or on
with **Show tips** at the bottom of the menu (saved on their profile, so it follows them across
devices), dismiss single tips with **Got it**, and bring them back with **Show hidden tips again**.

## Importing data

Admins and Consolidators use **Import** with the template in
`public/templates/ConsolFlora_Import_Template.xlsx` (also linked as **Download template** on each list).

1. Choose the file and a sheet. Sheets are listed in import order:
   Lists → Farms → Customers → BoxTypes → Products → PackRates → PriceList → FreightRates → PackingList.
2. **Dry run** checks required fields, dropdown values, codes on other sheets, number and date
   ranges, duplicates, GLN and air waybill check digits, and packing-list rules. Errors read like
   `Row 14: box_code HBX is not on BoxTypes.` and can be downloaded as CSV. Nothing is saved.
3. **Import** unlocks only after a clean dry run. The server repeats the dry run, then
   `import_sheet()` saves the whole sheet in one transaction: existing keys update, new keys insert,
   nothing is deleted (`active = N` hides a record). Every import is logged in `import_runs`.

Record keys: Farms `farm_code`, Customers `customer_code`, Products `product_code`, BoxTypes
`box_code`, Lists `list + value`, PackRates `product_code + box_code`, PriceList
`farm_code + product_code + valid_from`, FreightRates `origin + destination + airline + valid_from`,
PackingList `shipment_ref + line position`. A PackingList import can't remove lines from a shipment
or change a closed shipment. Box numbers (1..N per shipment) are calculated by the database.

The template's columns are pinned by a test (`src/lib/import/template.test.ts`): if the template
changes, update `src/lib/import/schema.ts` to match.

## Project layout

```
src/
  routes/                 file-based routes (_app/* = signed-in pages)
  components/ui/          design-system components (button, card, alert, table, switch, toaster…)
  components/layout/      app shell, menu config (nav.ts), role guard
  components/tips/        navigation tips and the on/off switch
  components/import/      Import page parts
  lib/import/             template schema, .xlsx parser, dry-run rules, CSV export
  server/                 server functions (run as the signed-in user, RLS applies)
supabase/migrations/      schema, RLS policies, import function
docs/backend.md           what the backend must provide
```

## Progress

| # | Item | Status |
|---|---|---|
| 0 | App foundation: shell, sign-in, roles, master-data lists, tips | Done |
| 1 | Import page | Done |
| 2 | Label designer | Not started |
| 3 | Boxes on POs and packing lists | Not started |
| 4 | QC scanner | Not started |
| 5 | Shipment screen | Not started |
| 6 | Floricode | Not started |
| 7 | Legal and consent | Not started |
| 8 | Accessibility and security (WCAG 2.2 AA, 2FA) | Not started |
