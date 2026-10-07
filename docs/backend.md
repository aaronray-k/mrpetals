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
- **Mail (last item):** Zoho SMTP and IMAP settings and a mailbox (e.g. orders@consolflora.com), entered by you
  in the server environment, to send notifications and bring replies back into the app.
- The proforma and packing list are not yet attached to emails automatically; buyers see the order and its
  progress in the app, and staff download the files.

## Item 6: Dashboards and currency

Provided by migrations `…011_currency.sql` and `…012_dashboards.sql`.

| Object | Purpose |
|---|---|
| `exchange_rates`, `fx()` | Rates per currency pair from a date (the reverse rate is used when only that one exists). Staff read; Admin and Finance write. |
| `farm_price_in()`, `margin_in()`, `sell_price_in()` | Farm price, margin and buyer price in the buyer's currency. `margin_rules.currency` says which currency a margin is in. |
| `price_overrides.currency` | Fixed prices per incoterm and currency. |
| `catalog()`, `place_order()`, `line_farm_options()`, `generate_standing_orders()`, `order_packing_list`, `order_values` | Now in the buyer's currency. |
| `dashboard_staff()`, `dashboard_finance()`, `dashboard_qc()`, `dashboard_farm()`, `dashboard_buyer()` | One call per dashboard (period in weeks), each checking the caller's role. Farms and buyers only see their own. |
| `mail_settings` | Zoho host, port, user and from-address, Admin only. No passwords. |

Still needed from the backend:

- **Exchange rates** for every buyer currency other than USD (entered in the app).
- **Mail passwords** go in the server environment (`SMTP_PASSWORD`, `IMAP_PASSWORD`) when email is built.

## Item 7: Floricode

Provided by migration `…013_floricode.sql`.

| Object | Purpose |
|---|---|
| `floricode_products`, `floricode_feature_types`, `floricode_feature_values`, `floricode_packaging`, `floricode_companies` | Floricode's lists. Everyone signed in reads the codes; companies are staff only. Only the sync writes them. |
| `floricode_apply_sync(source, cursor, data)`, `floricode_log_failure()`, `floricode_sync_runs` | The sync (Admin only) and its log: when, from where, what changed. |
| `product_reviews`, `review_products()`, `resolve_product_review()` | Products flagged for review, opened and closed automatically. |
| `save_product()`, `products.floricode_features` | The product form: codes checked against Floricode; length, head size, maturity and grade filled from the features. |
| `set_box_packaging_code()` | Floricode packaging code per box type. |
| `box_label_data()` | Adds the Floricode name, features, packaging code and grower GLN for labels and the QR code. |

The app server fetches the data (`src/server/floricode.functions.ts`) and hands it to the database as the
signed-in Admin. Still needed:

- **Floricode API access:** ConsolFlora's Floricode account, its API documentation, and on the app server
  `FLORICODE_API_URL` and `FLORICODE_API_KEY`. The API client is the one function left to write
  (`fetchFromApi`); everything after it is built. Without them, "Sync now" says Floricode is not connected.
- `FLORICODE_SOURCE=demo` loads the demo master data instead. **Preview only**: never set it in production.
- A daily scheduled sync can be added like the standing-orders job once the API is connected.

## Item 8: Legal and consent

Provided by migration `…014_legal.sql`.

| Object | Purpose |
|---|---|
| `legal_documents` | Each document's current version and who must accept it (roles, or all). Public read. |
| `legal_acceptances` | Who accepted which version, when, and from which browser. |
| `profiles.legal_ok`, `profiles.marketing_opt_in` | Accepted everything current; optional marketing email. |
| `my_pending_documents()`, `accept_documents()`, `my_agreements()`, `set_marketing_opt_in()`, `admin_list_agreements()` | The sign-in step, My account and the Users page. |
| `has_role()`, `has_any_role()`, `my_farm_id()`, `my_customer_id()` | Now also require `legal_ok`, so no access until agreed. |

**Publishing a new version of a document:** change its text and version in `src/lib/legal/documents.ts`, and add a
migration `update legal_documents set version = '<new>' where code = '<code>';`. Everyone it applies to is
asked again at their next sign-in.

## Service fees

Provided by migration `…015_service_fees.sql`.

| Object | Purpose |
|---|---|
| `customers.service` | sourcing, consolidation, intake_qc or full_package. |
| `service_fees` | Per service: whether the per-stem fee applies, the fee per shipment and how it shows on the proforma. Admin and Finance edit. |
| `margin_rules.currency` | Null: the same figure in every currency (the rate card). Otherwise converted with `exchange_rates`. |
| `service_margin()`, `sell_price_for()` | The per-stem fee and buyer price for a service; used by the catalog, checkout, standing orders, the cost calculator and staff-entered orders. |
| `order_charges.kind = 'service_fee'`, `sync_service_fee()` | The fee per shipment, kept on the buyer's earliest active order on each flight by a trigger on `customer_orders`. |
| `my_service()` | The buyer's service and fee, for the catalog and checkout. |

## Item 9: Two-factor sign-in

Provided by migration `…016_two_factor.sql`. Built in the database rather than with Supabase Auth MFA, so that
email codes and 30-day remembered devices work the same way as authenticator apps.

| Object | Purpose |
|---|---|
| `security_settings` | Which roles need two-factor (Admin, Consolidator, Finance), days a device is remembered (30), and the preview-only `demo_show_email_codes` (must stay false in production). |
| `two_factor_totp`, `start_totp_setup()`, `verify_totp()` | Authenticator app (RFC 6238 TOTP, checked in SQL with pgcrypto). A code can't be used twice. |
| `two_factor_email_codes`, `send_two_factor_email()`, `verify_email_code()`, `email_outbox` | Email codes (10 minutes). Queued in `email_outbox` for the mail sender built with the email item. |
| `two_factor_sessions`, `current_session_id()`, `two_factor_ok()` | Verified sign-in sessions, from the JWT `session_id`. `has_role()` and `has_any_role()` require it. |
| `two_factor_devices`, `use_remembered_device()`, `forget_my_devices()` | Remembered devices: a random token in the browser, stored hashed, valid 30 days. |
| `admin_reset_two_factor()`, `admin_list_two_factor()` | Users page. |

Still needed: the **mail sender** (email item) to deliver `email_outbox`; until then only authenticator apps work
in production.

## Item 10: Buyer claims

Provided by migration `…017_claims.sql`.

| Object | Purpose |
|---|---|
| `ordering_settings.claim_window_hours`, `shipments.arrived_at`, `claim_deadline()` | The claim window (24 hours after landing by default). |
| `claims`, `claim_lines`, `claim_costs`, `claim_photos` + bucket `claim-photos` | The buyer's claim, per box, with photos and extra costs. Buyers see their own; staff, QC and Finance see all; farms never. |
| `claimable_boxes()`, `submit_claim()`, `withdraw_claim()` | Buyer. |
| `decide_claim_line()`, `decide_claim_cost()`, `finish_claim_review()` | Consolidator or Admin. Finishing creates the buyer's `credit_notes` row and the `farm_claim_notices`. |
| `farm_claim_notices`, `farm_claim_notice_lines`, `farm_claim_messages` + bucket `farm-credit-notes` | Per farm, at the farm's price and currency; the farm's credit note and the conversation. |
| `farm_send_credit_note()`, `claim_notice_message()`, `close_claim_notice()` | Farm and ConsolFlora. |

Credit notes go to Odoo as credit notes (item 11).

## Item 11: Invoices in Odoo

Provided by migration `…018_odoo.sql`; the Odoo calls are in `src/server/odoo/` (Odoo's external JSON-RPC API).

| Object | Purpose |
|---|---|
| `invoices` | One per buyer per closed shipment (made by a trigger on closing), and one per claim credit note. Total, currency, reference, orders; Odoo number, state, payment status, amount due, link. Buyers read their own. |
| `invoice_payload()` | What goes to Odoo: the buyer's business details, currency, date, reference, line name and total. Never farm prices or margins. |
| `record_odoo_push()`, `record_odoo_fetch()` | Results from the app server. A paid invoice marks its orders paid; the buyer is told of a new invoice, Finance of a payment, staff of a failed push. |
| `odoo_settings`, `odoo_sync_log`, `customers.odoo_partner_id` | Address, database, login, line name; every push, fetch, test, confirm and reset. |
| `odoo_settings.field_map`, `payment_term_map` (`…020_odoo_drafts.sql`) | Which Odoo invoice fields get the MAWB, proforma numbers and flight; which Odoo payment term each ConsolFlora term is. Sent in `invoice_payload()`. |
| `record_odoo_action()` | Confirm (`action_post`), reset to draft (`button_draft`) or refill a draft, done by the app server for Admin, Consolidator and Finance; logged, refusals included. |
| `apply_odoo_state()` | Every push, fetch and action: Odoo's number, state, due date. The first confirmation sets `posted_at` and tells the buyer; buyers only read confirmed invoices. A new draft notifies Finance. |

Needed to connect: Odoo **Custom plan** (Odoo Online), an Odoo user with Accounting rights and an **API key**
(`ODOO_API_KEY` on the app server), the address, database and login on Odoo settings, and each buyer currency
**active** in Odoo. Payments are fetched when Finance opens Invoices or presses Refresh; a scheduled fetch (for
example hourly) can be added on the server once connected.

## Not needed yet

- Odoo: no calls until the shipment and fulfilment items.
- Another Storage bucket: needed for item 5 (shipment documents).
