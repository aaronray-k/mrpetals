// Preview site only. A small stand-in for the parts of Supabase the app uses, so the preview runs on
// one Render web service with a plain Postgres database:
//   /auth/v1/*     password sign-in, refresh, change password, sign-out, and the admin users API
//   /storage/v1/*  file upload and download, stored in storage.objects under the user's RLS policies
//   /rest/v1/*     proxied to PostgREST
//   everything else  proxied to the app
// Production uses real Supabase (GoTrue, Storage, PostgREST); nothing here is used there.
import http from 'node:http'
import crypto from 'node:crypto'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const ACCESS_TTL = 3600

export function signJwt(secret, claims) {
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: now, ...claims })}`
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`
}

export function verifyJwt(secret, token) {
  const [h, p, s] = (token || '').split('.')
  if (!s) return null
  const want = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest()
  const got = Buffer.from(s, 'base64url')
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  if (claims.exp && claims.exp < Date.now() / 1000) return null
  return claims
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'access-control-expose-headers': '*',
}

/** Supabase-shaped user object. */
function userJson(u) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.created_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { ...(u.raw_user_meta_data ?? {}), must_change_password: u.must_change_password },
    created_at: u.created_at,
    updated_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    banned_until: u.banned ? '2999-01-01T00:00:00Z' : null,
  }
}

export function createGateway({ pool, jwtSecret, restPort, appPort }) {
  const failures = new Map() // ip -> { count, until }

  async function session(u) {
    const refresh = crypto.randomBytes(24).toString('base64url')
    await pool.query('insert into auth.refresh_tokens (token, user_id) values ($1, $2)', [refresh, u.id])
    const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL
    const access = signJwt(jwtSecret, { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp })
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: exp, refresh_token: refresh, user: userJson(u) }
  }

  const authError = (status, code, message) => [status, { code, error: code, error_description: message, msg: message, message }]

  async function auth(req, url, body) {
    const route = url.pathname.slice('/auth/v1'.length)
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, '')
    const claims = verifyJwt(jwtSecret, bearer)
    const json = body.length ? JSON.parse(body.toString()) : {}

    if (route === '/token' && url.searchParams.get('grant_type') === 'password') {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress
      const f = failures.get(ip)
      if (f && f.count >= 10 && f.until > Date.now()) return authError(429, 'over_request_rate_limit', 'Too many sign-in attempts. Wait 15 minutes and try again.')
      const { rows } = await pool.query(
        'select * from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)',
        [String(json.email ?? ''), String(json.password ?? '')],
      )
      const u = rows[0]
      if (!u || u.banned) {
        failures.set(ip, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + 15 * 60_000 })
        return authError(400, 'invalid_credentials', 'Invalid login credentials')
      }
      failures.delete(ip)
      await pool.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id])
      return [200, await session(u)]
    }
    if (route === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const { rows } = await pool.query(
        'update auth.refresh_tokens set revoked = true where token = $1 and not revoked and created_at > now() - interval \'30 days\' returning user_id',
        [String(json.refresh_token ?? '')],
      )
      if (!rows[0]) return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
      const u = (await pool.query('select * from auth.users where id = $1 and not banned', [rows[0].user_id])).rows[0]
      if (!u) return authError(400, 'user_banned', 'User is banned')
      return [200, await session(u)]
    }
    if (route === '/logout') {
      if (claims?.sub) await pool.query('update auth.refresh_tokens set revoked = true where user_id = $1', [claims.sub])
      return [204, null]
    }
    if (route === '/user') {
      if (!claims?.sub) return authError(401, 'bad_jwt', 'invalid JWT')
      if (req.method === 'PUT') {
        if (json.password != null) {
          if (String(json.password).length < 10) return authError(422, 'weak_password', 'Password should be at least 10 characters.')
          await pool.query(
            'update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt(\'bf\')), must_change_password = false where id = $1',
            [claims.sub, String(json.password)],
          )
        }
        if (json.data) await pool.query('update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, \'{}\') || $2 where id = $1', [claims.sub, json.data])
      }
      const u = (await pool.query('select * from auth.users where id = $1 and not banned', [claims.sub])).rows[0]
      return u ? [200, userJson(u)] : authError(401, 'user_not_found', 'User not found')
    }

    // Admin API: only with the service-role key, which only the app's server holds.
    if (route.startsWith('/admin/users')) {
      if (claims?.role !== 'service_role') return authError(403, 'not_admin', 'User not allowed')
      const id = route.split('/')[3]
      if (req.method === 'GET' && !id) {
        const { rows } = await pool.query('select * from auth.users order by created_at')
        return [200, { users: rows.map(userJson), aud: 'authenticated' }]
      }
      if (req.method === 'GET') {
        const u = (await pool.query('select * from auth.users where id = $1', [id])).rows[0]
        return u ? [200, userJson(u)] : authError(404, 'user_not_found', 'User not found')
      }
      if (req.method === 'POST') {
        const email = String(json.email ?? '').trim().toLowerCase()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(422, 'validation_failed', 'Unable to validate email address: invalid format')
        if (String(json.password ?? '').length < 10) return authError(422, 'weak_password', 'Password should be at least 10 characters.')
        try {
          const { rows } = await pool.query(
            `insert into auth.users (id, email, encrypted_password, raw_user_meta_data, must_change_password)
             values (gen_random_uuid(), $1, extensions.crypt($2, extensions.gen_salt('bf')), $3, coalesce(($3 ->> 'must_change_password')::boolean, false)) returning *`,
            [email, String(json.password), json.user_metadata ?? {}],
          )
          return [200, userJson(rows[0])]
        } catch (e) {
          if (e.code === '23505') return authError(422, 'email_exists', 'A user with this email address has already been registered')
          throw e
        }
      }
      if (req.method === 'PUT') {
        const sets = []
        const args = [id]
        if (json.password != null) {
          if (String(json.password).length < 10) return authError(422, 'weak_password', 'Password should be at least 10 characters.')
          args.push(String(json.password))
          sets.push(`encrypted_password = extensions.crypt($${args.length}, extensions.gen_salt('bf'))`)
        }
        if (json.user_metadata) {
          args.push(json.user_metadata)
          sets.push(`raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || $${args.length}`)
          if ('must_change_password' in json.user_metadata) {
            args.push(Boolean(json.user_metadata.must_change_password))
            sets.push(`must_change_password = $${args.length}`)
          }
        }
        if (json.ban_duration) {
          args.push(json.ban_duration !== 'none')
          sets.push(`banned = $${args.length}`)
        }
        if (!sets.length) return authError(422, 'validation_failed', 'Nothing to update')
        const { rows } = await pool.query(`update auth.users set ${sets.join(', ')} where id = $1 returning *`, args)
        if (json.ban_duration && json.ban_duration !== 'none') await pool.query('update auth.refresh_tokens set revoked = true where user_id = $1', [id])
        return rows[0] ? [200, userJson(rows[0])] : authError(404, 'user_not_found', 'User not found')
      }
    }
    if (route === '/settings') return [200, { external: { email: true }, disable_signup: true }]
    return authError(404, 'not_found', 'Not found')
  }

  async function storage(req, url, body) {
    const claims = verifyJwt(jwtSecret, (req.headers.authorization || '').replace(/^Bearer /, ''))
    if (!claims?.sub) return [403, { statusCode: '403', error: 'Unauthorized', message: 'Sign in first' }]
    const rest = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length)).replace(/^authenticated\//, '')
    const slash = rest.indexOf('/')
    const bucket = rest.slice(0, slash)
    const name = rest.slice(slash + 1)
    if (slash < 1 || !name || name.includes('..')) return [400, { statusCode: '400', error: 'Bad request', message: 'Bad path' }]

    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('set local role authenticated')
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: claims.sub, role: 'authenticated' })])
      if (req.method === 'POST' || req.method === 'PUT') {
        let data = body
        let type = req.headers['content-type'] || 'application/octet-stream'
        if (type.startsWith('multipart/form-data')) {
          const form = await new Response(body, { headers: { 'content-type': type } }).formData()
          const file = [...form.values()].find((v) => typeof v !== 'string')
          data = Buffer.from(await file.arrayBuffer())
          type = file.type || 'application/octet-stream'
        }
        if (data.length > 10 * 1024 * 1024) return [413, { statusCode: '413', error: 'Payload too large', message: 'The file is larger than 10 MB.' }]
        const upsert = req.headers['x-upsert'] === 'true'
        await client.query(
          `insert into storage.objects (bucket_id, name, content_type, data) values ($1, $2, $3, $4)
           ${upsert ? 'on conflict (bucket_id, name) do update set data = excluded.data, content_type = excluded.content_type' : ''}`,
          [bucket, name, type, data],
        )
        await client.query('commit')
        return [200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() }]
      }
      const { rows } = await client.query('select data, content_type from storage.objects where bucket_id = $1 and name = $2', [bucket, name])
      await client.query('commit')
      if (!rows[0]) return [400, { statusCode: '404', error: 'not_found', message: 'Object not found' }]
      return [200, rows[0].data, rows[0].content_type]
    } catch (e) {
      await client.query('rollback').catch(() => {})
      if (e.code === '42501') return [403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }]
      if (e.code === '23505') return [400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }]
      throw e
    } finally {
      client.release()
    }
  }

  function proxy(req, res, port, path, strip) {
    const headers = { ...req.headers }
    if (strip) {
      delete headers.apikey
      const token = (headers.authorization || '').replace(/^Bearer /, '')
      if (headers.authorization && !verifyJwt(jwtSecret, token)) delete headers.authorization
    }
    const up = http.request({ host: '127.0.0.1', port, path, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, strip ? { ...r.headers, ...cors } : r.headers)
      r.pipe(res)
    })
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('The preview is starting. Try again in a moment.')
    })
    req.pipe(up)
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    try {
      if (url.pathname.startsWith('/rest/v1/')) return proxy(req, res, restPort, url.pathname.slice(8) + url.search, true)
      const isAuth = url.pathname.startsWith('/auth/v1/')
      const isStorage = url.pathname.startsWith('/storage/v1/object/')
      if (!isAuth && !isStorage) return proxy(req, res, appPort, req.url, false)
      if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks)
      const [status, payload, type] = isAuth ? await auth(req, url, body) : await storage(req, url, body)
      if (payload == null) return res.writeHead(status, cors).end()
      if (Buffer.isBuffer(payload)) return res.writeHead(status, { ...cors, 'content-type': type ?? 'application/octet-stream' }).end(payload)
      res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(payload))
    } catch (e) {
      console.error(e)
      if (!res.headersSent) res.writeHead(500, { ...cors, 'content-type': 'application/json' })
      res.end(JSON.stringify({ message: 'Something went wrong on the preview server.' }))
    }
  })
}
