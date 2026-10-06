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
- **Environment for the app:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time.
  The app never uses the service-role key: server functions act as the signed-in user.

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
| `label_prints` | Print and reprint log: box, template version, who, when, reason (required for reprints). The link to the boxes table is added in item 3. |
| `save_label_template(...)` | Saves a new version in one transaction, and refuses if someone else saved first. |
| `label_template_version_for(customer)` | The version to print for a buyer: theirs, or the default. |

Logos ship with the app (`public/labels`), so no storage bucket is needed for labels.

## Not needed yet

- Odoo: no calls until the shipment and fulfilment items.
- Storage bucket: needed for item 5 (shipment documents).
