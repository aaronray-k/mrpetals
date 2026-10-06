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
| `npm run test:db` | Database tests: migrations, functions and RLS ([details](supabase/tests/run.sh)) |
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

## Box labels

Admins design box labels under **Label designer**. A template has a size (150 × 70 mm by default,
100 × 150 and 100 × 100 presets, or custom), a printer feed (sideways for labels wider than a 4-inch
printer), the ConsolFlora logo, and fields picked from a list with an English or Dutch caption. The QR
code, box ID and "Box n of N" are always on the label. A template can be the default or belong to one
buyer. Saving makes a new version; old versions never change.

- **One engine, three outputs.** `src/lib/labels/engine.ts` turns a template and a box into drawing
  steps; the preview (SVG), PDF (`pdf.ts`) and Zebra ZPL at 203 or 300 dpi (`zpl.ts`) all draw the same
  steps, so what you see is what prints.
- **QR content** comes from `src/lib/labels/qr-format.ts`. Until Florisoft's specification arrives it
  uses a placeholder, `CF1|<box id>|<shipment>|<n>/<N>`. To switch, add a formatter there and point
  `ACTIVE_QR_FORMATTER` at it; the designer, PDF, ZPL and (later) the QC scanner all follow.
- **Logos** are `public/labels/consolflora-logo-full.png` and `consolflora-logo-mark.png` (from
  consolflora.com). Replace those files to change the logo on every label. For Zebra printers the logo is
  converted to black and white, and sent to the printer once per file.
- **Zebra notes:** the printer's built-in font is narrower than the preview's, and has one weight, so bold
  text is printed twice a dot apart. Label text supports Western European characters; others print as "?".
- **Reprints** print a REPRINT mark at the position set in the template. Every print and reprint (with the
  reason) is logged in `label_prints`, with the box numbers the label showed.

## Orders, farm POs and boxes

1. **Order.** A buyer's order is in stems (from the self-order platform later; staff can enter one under
   **Orders → New order**). Its number is `CFL<buyer code><0001>`. Each line takes ConsolFlora's margin
   per stem from **Margins** for the order's incoterm (the current FOB rules: up to 50 cm $0.010, longer
   $0.015). Staff can change a line's margin; changing the order's incoterm re-applies that incoterm's rules.
2. **Split to farms.** On the order, staff add farms to each line until every stem is placed. Each farm
   gets one PO per order (`PO-2026-00001`); farms never see the buyer or the margin. Stems per box come from
   the pack rate, the grower price from the price list (staff can set it when the list has none).
3. **Send and confirm.** Staff send the PO; the farm confirms or declines (with a reason) on
   **My purchase orders**, or staff record the farm's answer. A declined PO goes back to draft when it is edited.
4. **Assign boxes.** On a confirmed PO this creates the boxes on the order's shipment: stems ÷ stems per
   box, rounded up, the last box holding the rest. Box ids are 8 digits from a database sequence and never
   change or get reused.
5. **Shipment.** Boxes are numbered per buyer ("042 / 180") and per farm ("Farm box 3 / 12"), in the order
   they were created. Staff mark boxes **Received**, QC records **passed** or **failed** (with a note), then
   labels print as PDF or ZPL, only for received boxes that passed QC. A box that drops out is **voided**,
   never deleted: while the shipment is open the boxes after it move up a number, and labels that show old
   numbers are flagged for reprint. **Close shipment** freezes the numbers.
6. **Proforma and packing list.** Downloaded from the order or the shipment as Excel, in the layout of the
   current proforma (farms in box order, margin and unit price formulas, other costs, grand total). The
   packing list is the same without prices. A proforma won't download while a line has no grower price.

## Project layout

```
src/
  routes/                 file-based routes (_app/* = signed-in pages)
  components/ui/          design-system components (button, card, alert, table, switch, toaster…)
  components/layout/      app shell, menu config (nav.ts), role guard
  components/tips/        navigation tips and the on/off switch
  components/import/      Import page parts
  lib/import/             template schema, .xlsx parser, dry-run rules, CSV export
  lib/labels/             label layout, QR formatter, render engine, PDF and ZPL output
  components/labels/      label designer (canvas, inspector, settings, versions)
  lib/orders/             orders, POs and boxes API, label printing, proforma and packing list Excel
  components/orders/      order lines, farm POs, boxes table, statuses
  server/                 server functions (run as the signed-in user, RLS applies)
supabase/migrations/      schema, RLS policies, import function
docs/backend.md           what the backend must provide
```

## Progress

| # | Item | Status |
|---|---|---|
| 0 | App foundation: shell, sign-in, roles, master-data lists, tips | Done |
| 1 | Import page | Done |
| 2 | Label designer | Done |
| 3 | Boxes on POs and packing lists | Done |
| 4 | QC scanner | Not started |
| 5 | Shipment screen | Not started |
| 6 | Floricode | Not started |
| 7 | Legal and consent | Not started |
| 8 | Accessibility and security (WCAG 2.2 AA, 2FA) | Not started |
