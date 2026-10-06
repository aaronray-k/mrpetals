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
    if (!done.has('seed')) {
      console.log('demo data')
      const seed = fs.readFileSync(path.join(here, 'seed.sql'), 'utf8').replaceAll(":'demo_password'", client.escapeLiteral(DEMO_PASSWORD))
      await client.query('begin')
      await client.query(seed)
      await client.query("insert into preview.applied (name) values ('seed')")
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
  PORT: String(APP_PORT),
})

createGateway({ pool, jwtSecret: JWT_SECRET, restPort: REST_PORT, appPort: APP_PORT }).listen(PORT, () => console.log(`preview on ${PORT}`))
