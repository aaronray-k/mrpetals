# Preview site

A clickable preview of ConsolFlora with demo data, on one Render web service and a Render Postgres
database. **Not for real data.** Production runs on Supabase (see `docs/backend.md`).

What runs on the web service (`node preview/start.mjs`):

- **Database setup** on start: `demo-shim.sql` (the bits of Supabase the migrations expect), every file in
  `supabase/migrations` not yet applied, and the demo data once: `seed.sql` (demo farms, buyers, products, an order split
  across farms, boxes part-way through QC, and one demo account per role), `seed-ordering.sql` (buyer
  orders and a standing order) and `seed-dashboards.sql` (a USD to EUR rate and eight weeks of past flights
  for the charts), then the first Floricode demo sync and `seed-floricode.sql` (codes on the demo products,
  packaging codes, GLNs, and one product still without a code). "Sync now" on the Floricode page then brings
  the demo changes: a blocked code, a renamed code, new codes and a blocked stem length.
- **PostgREST** (downloaded by `build.sh`) for the database API, exactly as Supabase uses it.
- **The app** (`srvx`, the normal production build).
- **`gateway.mjs`** in front: password sign-in, refresh, change password and the admin users API in place
  of Supabase Auth, and file storage in `storage.objects` in place of Supabase Storage. Uploads and
  downloads run as the signed-in user, so the Storage policies in the migrations apply.

Render settings: build `bash preview/build.sh`, start `node preview/start.mjs`, and environment
`DATABASE_URL`, `JWT_SECRET` (32+ random characters), `VITE_SUPABASE_URL` (the site's own address),
`VITE_SUPABASE_ANON_KEY=preview-anon`, `VITE_PREVIEW_DEMO_PASSWORD` and `DEMO_PASSWORD` (the same value).

To start over with fresh demo data, drop and recreate the database's `public`, `auth`, `storage` and
`preview` schemas (or create a new Render database) and redeploy.

Every demo account is asked to agree to its legal documents at its first sign-in after item 8, like a real user.

Admin, Consolidator and Finance demo accounts set up two-factor sign-in at their first sign-in (an authenticator app, or an email code, which the preview shows on screen because email is not connected).

Claims demo (`seed-claims.sql`): one claim waiting for review and one decided, with a claim notice to Kibo. On the preview only, the claim window is 30 days so the demo buyer can report on the past weeks' flights; the default is 24 hours.

Invoices go to a demo Odoo on the preview (`ODOO_SOURCE=demo`, set by `start.mjs`): invoices arrive as drafts with sample invoice fields (MAWB, Proforma Invoice No, Flight Number) and payment terms; confirming gives an Odoo-style number, and the demo buyer pays each invoice a few minutes after it is confirmed. The demo has no PDFs, so the preview is the live one. Statements of account read a demo ledger: four suppliers (Fontana with a USD and a EUR account) and the two demo buyers, about six months of bills, invoices, refunds and payments.
