# What the backend must provide

Checklist for the self-hosted Supabase and other services, per item. Everything the front end needs
from the database is in `supabase/migrations`; this file lists the rest.

## Supabase (needed now)

- **Run the migrations** in `supabase/migrations` in file-name order.
- The migrations rely on standard Supabase setup: the `anon` and `authenticated` roles, `auth.users`,
  `auth.uid()`, the `public` schema exposed through PostgREST, and Supabase's default grants on
  `public` (tables and functions granted to `anon` and `authenticated`; RLS then restricts them).
- **First Admin.** Create the user in Supabase Studio (Authentication → Add user), then:

  ```sql
  insert into public.user_roles (user_id, role)
  select id, 'admin' from auth.users where email = 'you@consolflora.com';
  ```

  Admins can grant roles to others the same way (an RLS policy allows Admin to insert and delete
  `user_roles`). A role management screen is not built yet.
- **Senior QC** users get both roles, `qc` and `senior_qc`. Only Senior QC and Admin can clear a box that
  failed QC as Major.
- **Linking Farm and Customer users.** These users only see their own data. Link them with SQL
  (users can't change their own link; the column is not writable through the API):

  ```sql
  update public.profiles set farm_id = (select id from public.farms where farm_code = 'KIBO')
  where id = (select id from auth.users where email = 'sales@kiboroses.co.ke');
  ```

- **Auth settings (GoTrue):**
  - SMTP configured, for "Forgot password" emails.
  - `GOTRUE_SITE_URL` set to the app's address, and `https://<app>/sign-in` on the redirect allow list.
  - Keep public sign-up **off** (`GOTRUE_DISABLE_SIGNUP=true`) until item 7 adds the sign-up page with
    the Terms of sale consent. Until then, accounts are created by an Admin.
- **Environment for the app:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time, and
  `SUPABASE_SERVICE_ROLE_KEY` on the server only (never prefixed `VITE_`). The service-role key is used
  only by `src/server/users.functions.ts`, to create accounts and set passwords through Supabase Auth's
  admin API, after checking the caller is an Admin. Every other server call acts as the signed-in user.

## Item 1: Import

Provided by `20261006000002_import.sql`; nothing else is required.

| Object | Purpose |
|---|---|
| `import_runs` | Import log: who, when, file, sheet, rows inserted and updated, failures. Staff can read it; nobody can edit or delete it. |
| `import_sheet(sheet, file_name, rows)` | Saves one validated sheet in one transaction. Runs as the caller (`security invoker`), so RLS applies. Refuses non-staff, unknown codes, closed shipments and packing lists that would lose lines. |

The PackingList import uses a temporary table, so the `authenticated` role needs the `TEMPORARY`
privilege on the database. Postgres grants this to everyone by default; only check it if your
setup removed it.

## Item 2: Label designer

Provided by `20261006000003_labels.sql`; nothing else is required.

| Object | Purpose |
|---|---|
| `label_templates` | Template name, the buyer it belongs to or the default flag. One default and one template per buyer. Admin writes; Admin, Consolidator and QC read. Not deletable. |
| `label_template_versions` | Every saved version: size, feed, layout. Can't be changed or deleted. A check makes sure the QR code, box ID and "Box n of N" are in every layout. |
| `label_templates_current` | View: each template with its latest version. Runs with the caller's permissions (`security_invoker`, Postgres 15 or later, which Supabase uses). |
| `label_prints` | Print and reprint log: box, template version, who, when, reason (required for reprints), and the box numbers printed. Written only by `print_labels()`. |
| `save_label_template(...)` | Saves a new version in one transaction, and refuses if someone else saved first. |
| `label_template_version_for(customer)` | The version to print for a buyer: theirs, or the default. |

Logos ship with the app (`public/labels`), so no storage bucket is needed for labels.

## Item 3: Boxes on POs and packing lists

Provided by `20261006000004_orders_boxes.sql`. Status changes, numbering and box rows only change
through the functions below (security definer, each with its own role check); direct writes are revoked.

| Object | Purpose |
|---|---|
| `margin_rules`, `margin_for(incoterm, product)` | Margin per stem by incoterm, stem length and optionally flower type. Seeded with today's FOB rules. Admin and Finance edit. |
| `customer_orders`, `customer_order_lines`, `order_charges` | Buyer orders in stems, per-line margin, other costs. Staff, Finance and the buyer read. |
| `purchase_orders`, `purchase_order_lines` | One PO per farm per order. A farm sees its own POs once sent, never the buyer. |
| `boxes` (`box_id_seq` from 10000001) | One row per box, with received, QC and void status, and buyer and farm numbering. |
| `create_customer_order`, `allocate_order_line`, `remove_allocation`, `set_grower_price`, `send_purchase_order`, `respond_purchase_order`, `assign_boxes` | Order to boxes. |
| `receive_boxes`, `set_qc_result`, `void_box`, `close_shipment`, `print_labels` | Shipment work. `print_labels` refuses boxes that are void, not received or not passed, needs a reason for reprints, and logs every print. |
| `box_overview`, `order_packing_list`, `buyer_directory` | Views for the shipment page, the Excel export, and buyer names for QC. |

Still needed from the backend:

- **Emailing POs to farms.** "Send to farm" only changes the status; the farm sees the PO on its page.
  An email or WhatsApp notice to the farm's sales agent needs a mail service (a Supabase Edge Function
  or Odoo).
- **Farm users** must be linked to their farm (`profiles.farm_id`, see above) to see their POs.
- **Margins for other incoterms.** Only FOB rules exist. Orders on CPT, CIF and so on start without a
  margin until rules are added on the Margins page.
- **The self-order platform** will call `create_customer_order` (or an equivalent that marks the order
  `source = 'self_order'`); its screens are a later item. HAWB per buyer is part of item 5.

## Item 4: QC scanner

Provided by `20261006000005_senior_qc_role.sql` and `20261006000006_qc.sql`.

| Object | Purpose |
|---|---|
| `senior_qc` role | Clears Major QC failures. Granted by Admin, together with `qc`. |
| `qc_reasons` | Reasons from the Pacific Floral Japan claim policy. Pests are marked "always Critical". Add or retire reasons with SQL (`active = false`). |
| `boxes.qc_severity`, `boxes.qc_reasons`, status `back_to_farm` | The QC result per box. |
| `qc_events` | Every scan and result, with the phone's time and an id made on the phone (a resend is recorded once). |
| `qc_photos` + Storage bucket `qc-photos` | Photo evidence, stored as `<box id>/<file>.jpg`. QC roles upload; QC, Finance, staff and the box's farm can view. |
| `back_to_farm_stickers` | Log of BACK TO FARM sticker prints. |
| `qc_scan`, `qc_record`, `back_to_farm_sticker` | Scan (receives the box), record a result, sticker data. `set_qc_result` from item 3 still works. |

Still needed from the backend:

- **Supabase Storage** must be running (it is part of the standard self-hosted stack). The migration creates
  the private `qc-photos` bucket and its policies on `storage.objects`. Allow uploads of at least 5 MB
  (photos are shrunk to 1600 px on the phone first).
- **HTTPS** for the app: Android Chrome only opens the camera on secure pages.
- Buyer claims (a buyer submits a claim with photos; staff review it; costs are charged to the farm) are a
  separate item. They will reuse the QC photos and reasons.

## Item 5: Ordering flow and shipment release

Provided by migrations `…007_shipment_release.sql` to `…010_release_boxes.sql`.

| Object | Purpose |
|---|---|
| `ordering_settings` | Lead time (72 h), farm delivery (48 h before the flight), standing orders created 5 days ahead. Admin edits. |
| `price_overrides`, `catalog()`, `sell_price()` | Buyer prices per product: cheapest farm + incoterm margin, or a pinned farm, or a fixed price. Buyers never see farm prices. |
| `available_flights()`, `place_order()`, `approve_order()`, `decline_order()` | Buyer checkout and ConsolFlora approval. |
| `line_farm_options()` | The cost calculator: every farm's price, buyer price, margin, recommended farm. Staff and Finance only. |
| `answer_purchase_order()` | Farms confirm each line in full or in part, with the delivery date. |
| `order_line_coverage`, `create_packing_list()`, `order_progress()` | Shortfalls, the packing-list step, the buyer's view of progress. |
| `standing_orders`, `generate_standing_orders()` | Weekly repeating orders. **Schedule `select generate_standing_orders();` hourly** with Supabase pg_cron (the preview runs it from its server). |
| `notifications` | In-app notices per audience (staff, finance, buyer, farm), with `email_status` waiting for item 6. |
| `customer_orders.payment_status`, `mark_order_paid()` | Payment, Finance and Admin only. Prepaid = payment terms "Prepaid". |
| `buyer_credit`, `order_values` | Open, unpaid order value against the credit limit (a warning only). |
| `shipment_documents` + Storage bucket `shipment-docs` | KEPHIS phyto and certificate of origin per buyer, customs export entry per shipment. |
| `shipment_release`, `shipment_blockers()`, `close_shipment(shipment, override)`, `shipment_overrides` | The release gate, and Admin's logged override. |
| `admin_list_users()`, `admin_set_user()`, `profiles.active` | Users page: roles, links, switching accounts off. |

Still needed from the backend:

- **pg_cron** (or another scheduler) calling `generate_standing_orders()` hourly.
- **`SUPABASE_SERVICE_ROLE_KEY`** on the app server, for the Users page.
- **Mail (item 6):** Zoho SMTP and IMAP settings and a mailbox (e.g. orders@consolflora.com), entered by you
  in the server environment, to send notifications and bring replies back into the app.
- The proforma and packing list are not yet attached to emails automatically; buyers see the order and its
  progress in the app, and staff download the files.

## Not needed yet

- Odoo: no calls until the shipment and fulfilment items.
- Another Storage bucket: needed for item 5 (shipment documents).
