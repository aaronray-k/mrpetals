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
the farm or customer linked on their profile. Admin creates accounts on the **Users** page with a
temporary password; the person chooses their own at first sign-in. Switching an account off removes
its access at once.

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
   **Orders → New order**). Its number is `CFL<buyer code><0001>`. Each line takes ConsolFlora's fee per
   stem from **Fees and margins** for the order's incoterm and the buyer's service (see Service fees below).
   Staff can change a line's margin; changing the order's incoterm re-applies that incoterm's rules.
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

## Buyer ordering

1. **Catalog** (buyers): every product a farm can supply, with the buyer's price per stem for their
   incoterm, per variety and stem length. The price is the cheapest farm's price plus the incoterm margin,
   unless Admin pinned a farm or fixed the price on **Selling prices**.
2. **Checkout**: stems per line; bunching is standard (the product's bunch size), the buyer's own (stems per
   bunch, sleeves, bunch labels) or "ConsolFlora decides". The buyer picks one of the open flights to their
   airport, or another date. Orders need **72 hours** before the ship date (an Admin setting); farms deliver
   **48 hours** before it. New buyers are told the flight may change.
3. **Approval**: the order waits under **Orders → Waiting for approval**. Staff approve or decline it
   (with a reason the buyer sees). Finance or Admin can decline an approved order, e.g. over the credit limit.
4. **Farms**: the **cost calculator** on each line lists every farm's price, what the buyer pays and the
   margin (a loss shows in red), and recommends the cheapest (or the pinned farm). Farms answer each line in
   full or in part and confirm the delivery date; a shortfall shows on the line for ConsolFlora to place.
5. **Packing list**: once every stem is confirmed, **Create packing list** makes all the boxes at once.
6. **Payment and release**: Finance or Admin mark orders paid. A shipment closes only when, for each buyer,
   the KEPHIS phytosanitary certificate and certificate of origin are in and checked, prepaid orders are paid,
   and every box is received, passed by QC and labelled; plus the customs export entry for the shipment.
   Credit buyers over their limit only get a warning. Admin can close anyway, with a logged reason.
7. **Standing orders**: buyers set ship days (e.g. Monday and Thursday) and lines; each week's order is
   created 5 days ahead, already approved. Buyers can skip a week or change the standing order.
8. **Following an order**: buyers see each step under **My orders**; everyone gets **Notifications**
   (emailed once the mail settings are in; email is the last item).

## Service fees

ConsolFlora's rate card (from "Consolflora Services", 2026). Each buyer takes one **service**, set on the
**Customers** page; the service decides which fees apply. Fees are the same figure in euros or US dollars.

| Service | Fee per stem | Fee per shipment |
|---|---|---|
| Sourcing | Yes | none |
| Consolidation | No | 80 document consolidation fee |
| Intake and quality checks | No | 150 |
| Full package | Yes | 100 document consolidation fee |

- **Fee per stem**, per incoterm and stem length, on **Fees and margins**. FOB: 0.01 for 40/50 cm, 0.02 for
  60/70 cm, 0.025 for 80 to 120 cm. Each other incoterm has its own rules. It is included in the buyer's
  catalog price (farm price plus the fee); buyers on Consolidation or Intake and quality checks see the farm
  price only.
- **Fee per shipment** is added automatically to the buyer's first order on a flight, once per buyer per flight
  however many orders they place. If that order is declined or moved, the fee moves to their next order on
  the flight. It counts towards ConsolFlora's margin on the dashboards.
- Other charges (UCR, data loggers) are still added by hand on the order.
- Changes apply to new orders; orders already placed keep their prices.

## Dashboards and currency

The **Dashboard** opens with "Needs your action" lists and charts for your role. Pick **4 weeks**, **8 weeks**
(the default) or **6 months**; every chart has **Show as table**.

- **Orders and farms** (Admin, Consolidator): orders to approve, stems still to place, farms not answering
  within 24 hours, orders ready for their packing list, flights in the next 3 days that can't close yet;
  stems per week, farm fill rate, margin per week. **Orders by buyer** opens each buyer to list their open
  orders, with a link to place each one with farms.
- **Finance** (Admin, Finance): prepaid orders to collect, buyers over their limit, farm lines with no grower
  price, missing exchange rates; credit use, paid and unpaid per week, margin by incoterm.
- **QC**: boxes waiting per flight, Major failures to clear, BACK TO FARM stickers to print; reasons and pass
  rate per farm.
- **My farm**: POs to answer, deliveries this week, boxes sent back; stems confirmed per week.
- **My orders** (buyers): orders to pay, waiting for approval, coming shipments; stems and spend.

**Currency:** each buyer works in their own currency (on the customer record), from catalog prices to the
proforma. Farm prices and margins are converted with **Exchange rates** (Admin or Finance enter e.g.
1 USD = 0.92 EUR, from a date). With no rate, the buyer sees no price for those products rather than a
wrong one, and Finance gets a warning. Fixed prices on **Selling prices** are set per currency. Prices are
frozen on the order when it is placed.

**Email settings** (Admin) holds the Zoho mailbox details for later. Passwords never go in the app: they go
in the server environment. Email stays off until the email item.

## QC scanning

**Scan boxes** (QC, Senior QC, Admin, Consolidator) is made for Android phones. Pick the shipment, then
scan each box's QR code with the camera (Chrome's built-in reader, or jsQR where that's missing), type
the 8-digit box id, or use a handheld scanner.

- **A scan receives the box** and ticks it on the packing list, and shows **"Box 42 of 180"** in big type
  with the farm box number, farm, variety and stems. A wrong shipment, void or returned box, or a label
  that isn't ours gives a vibration, a sound and a message in words.
- **Results**, with reasons from the Pacific Floral Japan quality and claim policy:
  - **Pass**: ready for its label.
  - **Minor**: passes; the reason and note are recorded.
  - **Major**: fails; fix it at ConsolFlora, then a **Senior QC** (or Admin) clears it.
  - **Critical: BACK TO FARM**: the box leaves the shipment (later boxes move up a number while the shipment
    is open) and a **BACK TO FARM sticker** prints (PDF or ZPL, same size as the buyer's label). Pests always
    mean Critical.
- **Photos** can be added to any flagged box as evidence for claims. The farm sees its returned boxes, with
  reasons and photos, under **My purchase orders → Sent back to you**.
- **Connection drops:** scans, results and photos made without a connection wait on the phone (they survive
  a reload) and send by themselves; each has an id made on the phone, so nothing is recorded twice.
- The shipment page uses the same severities: **Flag…** for several boxes at once, and the sticker button
  on returned boxes.

## Floricode

**Floricode** (Master data) holds Floricode's lists: VBN product codes, features (stem length, flower head
size, ripeness stage, quality group, flowers per stem), packaging codes and the company register.

- **Sync now** (Admin) brings in Floricode's changes. The page shows where the codes come from, the last
  successful sync, what changed, and any failed sync with its reason. The preview uses demo master data shaped
  like Floricode's (example codes, not real ones): its first sync loads the lists, the next brings changes.
- **Products** are added and edited on the Products page. The VBN code, stem length, head size, ripeness and
  grade are picked from the Floricode lists; blocked codes can't be picked.
- **Needs review:** a product is flagged when it has no VBN code, its code isn't in the list, Floricode blocked
  its code (with the replacement to use) or one of its features, or Floricode renamed its code. Flags close by
  themselves once fixed; a renamed code is closed with **Mark as checked**. The Admin and Consolidator
  dashboard lists them. Flags are refreshed on every sync and every product save (imported products are
  checked at the next sync).
- **Box types** take their Floricode packaging code.
- **Labels:** the label designer can place the Floricode name, packaging code and grower GLN. The QR code now
  carries the Floricode codes:
  `CF2|<box id>|<shipment>|<n>/<N>|VBN:13000|Q01:A1|S20:070|S62:055|S98:2|PKG:901|GLN:<grower>|Q:<stems>`.
  The QC scanner still reads labels printed with the first format (`CF1|…`). When Florisoft's QR
  specification arrives, it replaces this format in one place (`src/lib/labels/qr-format.ts`).

## Legal and consent

Everyone agrees before using the app: **buyers** to the Terms of sale (with the Claims and credits policy),
**farms** to the Supplier terms (based on the Pacific Floral Japan quality and claim policy), **ConsolFlora
staff** to the Terms of use, and **everyone** to the Privacy and Cookie notices.

- At sign-in (after choosing a password, for new accounts) each document is shown in its own scroll box; its
  tick box unlocks once the person has scrolled to the end. "Agree and continue" stores each document's
  version and the time.
- Marketing email is a separate, optional box, unticked; buyers and farms can change it in **My account**,
  which also lists what they agreed to and when.
- The database enforces it: until someone has agreed to the current versions for their roles, they have no
  access, even through the API. A new version of a document (or a new role) asks again at the next sign-in.
- The **Users** page shows who has agreed and who is still waiting.
- The legal pages are public at `/legal` (no sign-in needed), linked from the footer of every page. Their text
  is a **placeholder marked "pending legal review"** (`src/lib/legal/documents.ts`).
- Only business contact details are kept: there are no ID number or date of birth fields anywhere.

## Two-factor sign-in and accessibility

**Admin, Consolidator and Finance** sign in with their password and then a 6-digit code:

- from an **authenticator app** (Google or Microsoft Authenticator): set up once by scanning a QR code, or
- by **email** to their account address (once the Zoho mailbox is connected; the preview shows the code on screen).

"Remember this device for 30 days" skips the code on that device. Five wrong codes lock the step for 15 minutes.
The database checks the code per sign-in session, so these roles have no access until it is done, even
through the API. **My account** shows the setup and can forget remembered devices; an Admin can **reset**
someone's two-factor on the **Users** page (lost phone). Other roles sign in with their password only.

Accessibility (WCAG 2.2 AA) is checked with axe on every page for every role, on phone and desktop and in dark
mode: labels on every input, tap targets of at least 24 × 24 px, status messages announced, severity and states
shown in words and icons as well as colour, visible keyboard focus (including chart columns), and no sideways
scrolling at 390 px.

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
  lib/qc/, components/qc/ QC scanning: QR reading, send queue, BACK TO FARM sticker, scan page parts
  lib/ordering/           catalog, cart, checkout, standing orders, release, prices, notifications
  components/shop/        catalog and cart parts; components/shipments/ release panel
  server/users.functions  account creation (the only use of the service-role key)
preview/                  the Render preview: demo backend, demo data
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
| 4 | QC scanner | Done |
| 5 | Ordering flow and shipment release: catalog, checkout, approval, cost calculator, partial farm answers, packing list, standing orders, payment, credit, documents, users | Done |
| 6 | Dashboards per role (charts and action lists), buyer currencies and exchange rates | Done |
| 7 | Floricode: codes, sync, product form, review flags, codes on labels and in the QR code | Done (demo data until Floricode API access) |
| 8 | Legal and consent: agreements per role at sign-in, public legal pages, marketing choice | Done (texts pending legal review) |
| 9 | Accessibility and security: two-factor sign-in (app or email, remembered devices), WCAG 2.2 AA sweep | Done (email codes wait for the mailbox) |
| 10 | Buyer claims (with QC photos) | Not started |
| 11 | Messages and email (Zoho: SMTP out, IMAP replies into the app); settings page already there | Not started |

A clickable preview with demo data runs on Render; see `preview/README.md`.
