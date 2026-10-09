// Preview site only: sets up the database, then runs PostgREST, the app and the gateway together.
//   DATABASE_URL   Render Postgres (internal URL)
//   JWT_SECRET     random, at least 32 characters
//   DEMO_PASSWORD  password for the demo accounts (default below)
//   PORT           set by Render
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createGateway, signJwt } from './gateway.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const PORT = Number(process.env.PORT ?? 10000)
const REST_PORT = 3002
const APP_PORT = 3001
const { DATABASE_URL, JWT_SECRET } = process.env
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'ConsolFlora-Demo-2026'
if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set DATABASE_URL and JWT_SECRET (32+ characters).')
  process.exit(1)
}

const ssl = /localhost|127\.0\.0\.1|@[a-z0-9-]+\/|\.internal/.test(DATABASE_URL) && !/render\.com/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl, max: 5 })

async function setUpDatabase() {
  const client = await pool.connect()
  try {
    await client.query(fs.readFileSync(path.join(here, 'demo-shim.sql'), 'utf8'))
    const done = new Set((await client.query('select name from preview.applied')).rows.map((r) => r.name))
    const dir = path.join(root, 'supabase', 'migrations')
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue
      console.log(`migration ${file}`)
      await client.query('begin')
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'))
      await client.query('insert into preview.applied (name) values ($1)', [file])
      await client.query('commit')
    }
    // A fresh database: the demo data is made through the app's functions as the demo Admin, with no
    // signed-in session, so two-factor is paused while it loads and switched back on below.
    const seeding = !done.has('seed')
    if (seeding) await client.query("update public.security_settings set two_factor_roles = '{}'")
    for (const [name, file] of [['seed', 'seed.sql'], ['seed-ordering', 'seed-ordering.sql'], ['seed-dashboards', 'seed-dashboards.sql'], ['seed-fees', 'seed-fees.sql'], ['seed-claims', 'seed-claims.sql']]) {
      if (done.has(name)) continue
      console.log(`demo data: ${file}`)
      const seed = fs.readFileSync(path.join(here, file), 'utf8').replaceAll(":'demo_password'", client.escapeLiteral(DEMO_PASSWORD))
      await client.query('begin')
      await client.query(seed)
      await client.query('insert into preview.applied (name) values ($1)', [name])
      await client.query('commit')
    }
    // Floricode: the first demo sync, as the demo Admin, then codes on the demo products.
    if (!done.has('seed-floricode')) {
      console.log('demo data: Floricode')
      const demo = JSON.parse(fs.readFileSync(path.join(root, 'src', 'server', 'floricode-demo.json'), 'utf8'))
      await client.query('begin')
      await client.query("select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000a', true)")
      await client.query("select public.floricode_apply_sync('demo', 'demo-initial', $1::jsonb)", [JSON.stringify(demo.initial)])
      await client.query(fs.readFileSync(path.join(here, 'seed-floricode.sql'), 'utf8'))
      await client.query("insert into preview.applied (name) values ('seed-floricode')")
      await client.query('commit')
    }
    // Item 8: every demo account accepts the legal documents at its next sign-in.
    if (!done.has('legal-reset')) {
      await client.query('begin')
      await client.query('select public.refresh_legal_ok(id) from public.profiles')
      await client.query("insert into preview.applied (name) values ('legal-reset')")
      await client.query('commit')
    }
    if (seeding) await client.query("update public.security_settings set two_factor_roles = array['admin', 'consolidator', 'finance']::public.app_role[]")
    // Preview only: email isn't connected, so two-factor email codes are shown on screen.
    if (!done.has('two-factor-demo')) {
      await client.query('update public.security_settings set demo_show_email_codes = true')
      await client.query("insert into preview.applied (name) values ('two-factor-demo')")
    }
    // A fresh test order for Pacific Floral on a new shipment (made after Odoo go-live), once.
    if (!done.has('test-order-pfj-1')) {
      console.log('test data: Pacific Floral test order')
      try {
        await client.query('begin')
        await client.query(fs.readFileSync(path.join(here, 'seed-test-order.sql'), 'utf8'))
        await client.query("insert into preview.applied (name) values ('test-order-pfj-1')")
        await client.query('commit')
      } catch (e) {
        // Test data only: never stop the preview over it.
        await client.query('rollback')
        console.error(`test data not added: ${e.message}`)
      }
    }
    // Buyers come from Odoo ("Import buyers from Odoo" on Customers): the demo buyers are marked as demo and
    // hidden (inactive) once. Their old demo orders stay; "Show inactive" on Customers shows them again.
    if (!done.has('demo-buyers-hidden')) {
      await client.query('begin')
      await client.query("update public.customers set source = 'demo', active = false where source = 'app'")
      await client.query("insert into preview.applied (name) values ('demo-buyers-hidden')")
      await client.query('commit')
    }
    // PostgREST picks up new functions and tables.
    await client.query("notify pgrst, 'reload schema'")
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

function run(name, cmd, args, env) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('exit', (code) => {
    console.error(`${name} stopped (${code}); restarting the preview`)
    process.exit(1)
  })
  return child
}

await setUpDatabase()

run('postgrest', path.join(here, 'bin', 'postgrest'), [], {
  PGRST_DB_URI: DATABASE_URL,
  PGRST_DB_SCHEMAS: 'public',
  PGRST_DB_ANON_ROLE: 'anon',
  PGRST_JWT_SECRET: JWT_SECRET,
  PGRST_SERVER_HOST: '127.0.0.1',
  PGRST_SERVER_PORT: String(REST_PORT),
  PGRST_DB_POOL: '5',
})

// The app's server talks to the gateway directly; the browser uses the public address baked in at build.
const serviceKey = signJwt(JWT_SECRET, { role: 'service_role', iss: 'consolflora-preview', exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 })
run('app', path.join(root, 'node_modules', '.bin', 'srvx'), ['serve', '--prod', '--entry', 'dist/server/server.js', '--static', '../client', `--port=${APP_PORT}`, '--host=127.0.0.1'], {
  VITE_SUPABASE_URL: `http://127.0.0.1:${PORT}`,
  VITE_SUPABASE_ANON_KEY: 'preview-anon',
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  // Floricode "Sync now" uses the demo master data (src/server/floricode-demo.json).
  FLORICODE_SOURCE: 'demo',
  // Invoices go to a demo Odoo (src/server/odoo/demo.ts) until ODOO_API_KEY is set; then to the real Odoo on
  // Odoo settings, once an Admin switches sending on there.
  ...(process.env.ODOO_API_KEY ? {} : { ODOO_SOURCE: 'demo' }),
  PORT: String(APP_PORT),
})

createGateway({ pool, jwtSecret: JWT_SECRET, restPort: REST_PORT, appPort: APP_PORT }).listen(PORT, () => console.log(`preview on ${PORT}`))

// Scheduler: creates the coming week's standing orders every hour (Supabase pg_cron does this in production).
async function standingOrders() {
  try {
    const { rows } = await pool.query('select public.generate_standing_orders() as n')
    if (rows[0].n) console.log(`standing orders: ${rows[0].n} created`)
  } catch (e) {
    console.error('standing orders:', e.message)
  }
}
void standingOrders()
setInterval(standingOrders, 60 * 60 * 1000)
