# Preview site

A clickable preview of ConsolFlora with demo data, on one Render web service and a Render Postgres
database. **Not for real data.** Production runs on Supabase (see `docs/backend.md`).

What runs on the web service (`node preview/start.mjs`):

- **Database setup** on start: `demo-shim.sql` (the bits of Supabase the migrations expect), every file in
  `supabase/migrations` not yet applied, and `seed.sql` once (demo farms, buyers, products, an order split
  across farms, boxes part-way through QC, and one demo account per role).
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
