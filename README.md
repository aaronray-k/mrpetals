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

## Buyer claims

1. **Buyer reports** (My claims → Report a problem, or from the order page) within the **claim window**: 24 hours
   after the flight lands, an Admin setting under **Ordering settings**. Staff enter when a flight landed on the
   shipment page; until then it counts from 08:00 the day after the flight. Per box: the reason, stems affected,
   a note and photos (the phone camera opens); plus extra costs such as fumigation. Boxes can be picked from the
   list or by scanning the box label.
2. **Consolidator reviews** (Claims): the buyer's photos sit next to ConsolFlora's QC result and photos for the
   same box. Each box is approved (all or some stems) or denied with a reason the buyer sees; each extra cost is
   approved or denied and charged to a farm.
3. **Finishing the review** gives the buyer a **credit note** (CN-2026-00001) in their currency, and sends each
   farm with approved boxes a **claim notice** (FCN-2026-00001) for its own boxes, at its own price and currency,
   with the photos. Farms never see the buyer or the buyer's price.
4. **The farm responds** (Claims on your flowers) with **its credit note**: number, amount, date and the
   document; or asks a question first. ConsolFlora replies, checks the credit note and closes the notice.

Everyone is notified at each step, and the dashboards list claims to review, farm replies, and notices to answer.

## Invoices in Odoo

Odoo makes the invoices; ConsolFlora keeps the detail and sends only the total.

- When a shipment **closes**, each buyer on it gets **one invoice for all their orders on that flight**. It goes to
  Odoo straight away as **one line, "Cut Flowers"**, with the grand total (flowers, service fees and charges) in the
  buyer's currency, the flight date and a reference such as `SHP-2026-0101 / CFLPFJ0001, CFLPFJ0003`. The buyer is
  matched to an Odoo customer by their code (or created). No tax is sent: Odoo's own setup applies.
- Each **claim credit note** goes to Odoo as a credit note: "Cut Flowers – credit (CLM-2026-00001)".
- They arrive in Odoo as **drafts**, with Odoo's own invoice fields filled in: the **MAWB**, the **proforma numbers**
  (the buyer's orders on the flight, e.g. CFLPFJ0001, CFLPFJ0003), the **flight number**, and the buyer's
  **payment terms** as an Odoo payment term (Odoo works out the due date). Admin, Consolidator or Finance open an
  invoice to see it as Odoo has it, with a **preview on the side** (live from Odoo, or Odoo's PDF once Odoo has
  made one), and **Confirm** it or **Reset to draft** without signing in to Odoo. **Fill in again from
  ConsolFlora** rewrites a draft (and a warning shows when Odoo's copy differs). Confirming also has Odoo make its
  **PDF** (Odoo's own Send & Print, with every way of sending switched off, so Odoo emails nobody); it shows on
  the **Odoo's PDF** tab with a download link. A confirmed invoice without one (from before, or if Odoo didn't
  make it) has a **Make Odoo's PDF** button. The PDF is made **without** submitting to KRA eTIMS
  (or any other e-invoicing step) and without emailing; submit to eTIMS from Odoo. Every invoice and credit note
  line carries an Odoo product, **Cut Flowers** (reference CONSOLFLORA-FLOWERS), which ConsolFlora makes in Odoo
  the first time it sends an invoice (or with **Make it in Odoo now** on Odoo settings); give it its eTIMS item
  code and taxes in Odoo. Test connection says whether your Odoo allows this. The buyer is told, with the due
  date, only once an invoice is confirmed, and buyers see only confirmed invoices. Finance is told of each new
  draft; the Finance dashboard lists the drafts to confirm.
- **Invoices** (Admin, Consolidator, Finance) lists them with the Odoo number (a link into Odoo), what is still
  due and the payment status. Anything Odoo didn't take shows why, with **Send waiting to Odoo** to retry.
  **Refresh from Odoo** fetches payments (also done when the page opens, if the last fetch is over 10 minutes
  old); a paid invoice marks its orders paid here. Buyers see their invoice on the order.
- **Odoo settings** (Admin): address, database, login, the line name, on/off, **Test connection** and recent
  activity. **Invoice fields in Odoo** reads the invoice form's text fields from Odoo and suggests which holds
  the MAWB, proforma number and flight (from their labels), and matches each buyer payment term to an Odoo one
  by its number of days; confirm and save once. The API key is only in the server environment (`ODOO_API_KEY`). Odoo Online needs the **Custom plan**
  for this. **Test connection** works while sending is off and checks the login, invoicing rights and that every
  buyer currency is active in Odoo. Switching sending on sets the **go-live** moment: invoices made before it are
  never sent; Send says so ("Made before Odoo go-live") rather than just "Not sent". Without `ODOO_API_KEY` (or on the preview until one is set) a demo Odoo is used; demo invoices are
  never sent to, or fetched from, the real Odoo.

## All invoices in Odoo, and new invoices

**All invoices in Odoo** (Admin, Consolidator, Finance) lists everything in Odoo, also documents made in Odoo
itself, on two tabs: **Sent to buyers** (invoices and credit notes) and **Received from growers** (bills and
refunds). Filters: name, number or reference, dates, status (draft, confirmed, cancelled) and payment (paid, not
paid); 50 at a time, with what is still due per currency. Opening one shows the side preview (live, or Odoo's PDF)
with **Confirm** and **Reset to draft**; one ConsolFlora made opens on its own invoice page.

**New invoice** (Invoices, or All invoices in Odoo) writes an invoice or credit note by hand: buyer, currency,
reference, MAWB, proforma no., flight, due date (suggested from the buyer's terms) and one or more lines
(description, quantity, unit price). It is saved in ConsolFlora and sent to Odoo as a draft, then confirmed like
the others; the buyer is told once it is confirmed.

## Emailing invoices to buyers

On a confirmed invoice, **Send by email** (Admin, Consolidator, Finance) opens the message, filled in and ready to
check or edit: a warm note greeting the buyer's contact by first name, the invoice number and amount, the
proforma(s), the flight and MAWB, the due date, the invoice number as payment reference and the bank account for
the invoice's currency, signed by the person sending ("Sales · Consolflora Limited"). Attached: **Odoo's invoice
PDF** (made first if missing) and the **proforma invoice** PDF of each order on it (the same layout and columns
as the Excel proforma; each can also be downloaded from the dialog). It goes from the sales mailbox on **Email settings**,
replies come back there, and each send is listed on the invoice (who, when, to whom, what was attached).

Email settings (Admin): the Zoho mailbox (sender name and address, smtp.zoho.com, port 465, user), **Send email**
on or off, **Send a test email to me**, and **bank details**: ConsolFlora's one bank (account name, bank, bank
code, branch, SWIFT) and the account number for each currency (KES, USD, EUR); an invoice email shows the account
number for the invoice's currency. The mailbox password is
`SMTP_PASSWORD` in the server environment, never in the app (for Zoho with two-factor sign-in, an app password).

## Shipment documents and contacts

**Shipment documents** (Admin, Consolidator, Finance; also **All documents** on a shipment): pick a shipment, or
find it by its **MAWB** (with or without the dash), a **Proforma Invoice No.** (the order number, e.g.
CFLPFJ0089), the shipment ref or an Odoo invoice number. Every document under it is listed buyer by buyer: each
order's **proforma invoice** (PDF) and the buyer's **Odoo
invoice** (draft or confirmed) and credit notes; choosing one shows it on the side. The Odoo invoice carries the
same MAWB, Proforma Invoice No. and flight in Odoo's own fields, so it can be found by them in Odoo too.

**Contacts (Odoo)** lists Odoo's contacts, read live: buyers, growers and the people and invoice addresses under
them, with emails and phones (edited in Odoo). An invoice email goes by default to the buyer's **invoice
addresses** in Odoo (otherwise the company's email, otherwise ConsolFlora's contact email); the dialog lists all
their Odoo contacts to add to To or Cc. Odoo customers are matched by the buyer's code (Odoo's reference); an Odoo
customer id from the preview's demo Odoo is never used with the real Odoo.

## Buyers from Odoo

Buyers come from Odoo's customer list. On **Customers**, Admin and Consolidator press **Import buyers from Odoo**
(read only in Odoo; run it again any time). Every company in Odoo that is a customer is:

- **linked** to the ConsolFlora buyer it already is: matched by its Odoo link, then its code (Odoo's Reference),
  then its exact name. That buyer is made active and only its empty details are filled from Odoo; its Odoo payment
  term comes too, if it has none yet.
- otherwise **added**: code from Odoo's Reference (or three letters of the name), contact email, phone, country,
  city, street and VAT from Odoo, currency of its latest Odoo invoice (USD if none), FOB, Prepaid, no credit, and
  its Odoo payment term. Odoo has no destination airport or ordering contact, so it shows **Needs details**: click
  it to fill in the contact, email, country, airport, incoterm and currency. Orders need those.

The preview's demo buyers are marked **Demo** and hidden (inactive); tick **Show inactive** to see them. Their
old demo orders stay. A buyer brought in from the preview's demo Odoo never keeps a demo Odoo id.

## Master price file

**Tools → Master price file** (Admin, Consolidator) loads the ConsolFlora master price workbook:

- Every sheet except those with **OFFER** in the name. Farms given only as a code (XFL, SSL, ABL/BVL…) and the
  placeholder farms (FARM 1, 2, 3) are left out. "CONSOL - Afri" is the farm whose name starts with "Afri"
  (Africalla); with no such farm, the suffix is the farm's name.
- Farm spellings are grouped, and the merges decided on 9 Oct 2026 apply (`src/lib/master/decisions.ts`):
  Panocal / Panocal International / PANACOL, Heritage, Florenza, Sierra Flora(l). Growers farming in several
  places keep one farm per place under their grower: Eco Roses, Fontana, Big Flowers, PJ Flowers.
- **Webshop varieties**: one per flower and name, whoever grows it, under the product catalogue's name and photo
  (`public/catalogue/`, 538 photos from the 2026 catalogue). Spellings sharing a catalogue photo are one variety.
- Per farm, variety and stem length: the farm price (USD, else EUR; from the import day, so older orders keep
  theirs), and the costing figures: FOB and CIF margins, stems per box, the box's weight. Products (variety ×
  length) are shared by the farms that grow them.
- The page shows what will be imported first; nothing is saved until **Import**. Importing again updates.
- **Freight rate** per kg (from the freight agent) is one setting, logged when changed. Freight per box = box
  weight × rate; per stem = per box ÷ stems per box; buying CIF = farm price + freight per stem; selling CIF =
  buying CIF + margin. Trucking to Madrid is kept but off for now.

## Varieties and the load planner

**Varieties** (staff, Finance, QC) shows every webshop variety once: its catalogue photo, flower, grade, colour,
stem lengths and the farms that grow it (grouped by grower). Filter by flower, photo or not, and search by name,
colour or farm. Click a variety for its farms.

**Tools → Load planner** works out how many boxes of one size fit in an air container, layer by layer, and shows it
in 3D (drag to turn; a slider hides upper layers). Containers: AKE (LD3, with its wing from 51 cm up, so the bottom
layers are narrower) and PMC pallets on the lower deck (163 cm) and main deck (244 and 300 cm). Each layer turns the
boxes, and mixes two directions, to fit the most; boxes stay flat unless "on their side" is ticked. With a box
weight it checks the container's weight limit; with stems per box it gives freight per stem at the freight rate
(chargeable weight: the higher of actual and volumetric, L × W × H cm ÷ 6000). It compares your box against every
box type in ConsolFlora. Sizes: AKE floor 156.2 × 153.4 cm, 200.2 cm wide above the wing, 163 cm high; PMC
317.5 × 243.8 cm. Change or add containers in `src/lib/freight/packing.ts`.

The **Shipment / mixed boxes** tab (the default) loads boxes of different sizes together: pull a shipment's boxes
(grouped by box type, with the pack rate's estimated weight) or type sizes and counts. Each box goes as low, then
as far back as it fits, turned whichever way fits best (and on its side when allowed), standing on at least 70%
support, clear of the AKE wing and within the weight limit; when a container is full the rest go into the next.
**Suggest best fit** tries every container the airline flies, flat and on the side, in three loading orders,
and picks the plan with the fewest containers, then the smaller container, then the tightest; it says what laying
boxes on their side gains. **Airlines** (EK, QR, ET, TK, KQ to start; table `airlines`, which containers each
flies) are compared on their best fit and freight at their rate per kg to the destination (entered from the freight
agent's quotes into `freight_rates`, NBO → airport, from the day it is saved).

## Payment terms

Terms are Prepaid, Net 7, Net 15, Net 30 and **15th of following month** (everything for a month's orders is due
on the 15th of the next month). New suppliers start on 15th of following month (an empty cell on the Farms sheet
gives it; on an existing supplier it keeps their terms). For a buyer on it, ConsolFlora sets the due date on the
Odoo invoice itself: the 15th of the month after the **latest order on the invoice was placed** (Nairobi time),
whatever day the invoice is confirmed, with no Odoo payment term. Supplier bills are entered in Odoo, so their due
dates (and "overdue" on supplier statements) come from Odoo: give those vendors a payment term there of
"15 days after end of month".

A buyer can also be given one of **Odoo's own payment terms**: Customers → "Odoo payment term" (Admin, Consolidator,
Finance; the list is read live from Odoo). That term wins over the terms column: their invoices go to Odoo with it and
no fixed due date, and Odoo works out the due date when the invoice is confirmed. A due date chosen on a manual
invoice still wins over everything. Drafts already in Odoo pick the term up with "Fill in again from ConsolFlora".

## Statements of account

**Statements of account** (Admin and Finance; also a shortcut on their dashboards) reads Odoo's ledger live:
suppliers' payable accounts (vendor bills, refunds and payments to them) or buyers' receivable accounts
(customer invoices, credit notes and payments from them). Nothing is written to Odoo or stored in ConsolFlora.

- One account per supplier (or buyer) and **currency**: a supplier billed in USD and EUR has "Fontana (USD)" and
  "Fontana (EUR)", each with its own balance. Currencies are never added together.
- Each account lists date, type, bill (or invoice) number, reference, due date, amount, paid / credited and a
  **running balance** from the **balance brought forward** (everything before the start date). Payments,
  refunds and credit notes are their own lines, so money already paid is in the balance. The closing balance
  shows how much of it is **overdue** (past due and not yet covered by payments, oldest first).
- Buyer statements also have a **MAWB** column, read only from the invoice's MAWB field in Odoo: the field chosen
  in field mapping (Odoo settings), else the field Odoo names MAWB / AWB. The page says which field it read, or
  warns if Odoo has none. Payments have none. The number search finds MAWBs too. It is in the PDF and Excel as well.
- Filters: suppliers or buyers, name, date range, **number or reference** (bill, invoice or payment number, or
  the vendor's reference; matching lines keep their true running balance), and **Include drafts**
  (confirmed only by default).
- **PDF** (A4 landscape) and **Excel** download exactly what is on screen: a summary per currency, then each
  account.
- Odoo settings' **Test connection** also checks that the Odoo user can read journal items and counts the
  confirmed vendor bills.

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
| 10 | Buyer claims: buyer report with photos, consolidator review, buyer credit notes, farm claim notices and farm credit notes | Done |
| 11 | Invoices in Odoo: one invoice per buyer per flight (one Cut Flowers line), credit notes, push and fetch | Done: drafts confirmed in ConsolFlora, with preview; statements of account (PDF, Excel) (demo Odoo until connected) |
| 12 | Messages and email (Zoho: SMTP out, IMAP replies into the app); important notifications emailed; settings page already there | Started: invoice emails to buyers (SMTP), test email; notifications by email and IMAP replies not yet |

A clickable preview with demo data runs on Render; see `preview/README.md`.
