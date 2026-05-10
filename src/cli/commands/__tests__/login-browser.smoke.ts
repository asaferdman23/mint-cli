/**
 * Browser OAuth integration smoke (no real network, no real browser).
 *
 * - Stubs `openFn` so we never launch a real browser; instead we POST to the
 *   callback URL the way the landing page would.
 * - Boots a fake gateway that accepts /auth/oauth-token and returns a
 *   synthetic API token.
 * - Redirects HOME / APPDATA / etc. to a tmpdir so we never touch the real
 *   ~/.mint/config.json.
 *
 * Run: `npx tsx src/cli/commands/__tests__/login-browser.smoke.ts`
 */
import assert from 'node:assert'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = mkdtempSync(join(tmpdir(), 'mint-oauth-smoke-'))
process.env.HOME = tmp
process.env.USERPROFILE = tmp
process.env.APPDATA = tmp
process.env.LOCALAPPDATA = tmp
process.env.XDG_CONFIG_HOME = tmp

const gateway = createServer((req, res) => {
  if (req.url?.startsWith('/auth/oauth-token') && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const parsed = JSON.parse(body) as { supabase_token?: string }
      assert.strictEqual(parsed.supabase_token, 'fake-supabase-jwt')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          token: 'mint_fake_api_token',
          email: 'smoke@example.com',
          plan: 'free',
        }),
      )
    })
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', () => resolve()))
const gatewayPort = (gateway.address() as { port: number }).port
process.env.MINT_GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`
process.env.MINT_WEB_URL = 'http://127.0.0.1:1'

const openCalls: string[] = []
async function fakeOpen(url: string): Promise<unknown> {
  openCalls.push(url)
  const u = new URL(url)
  const callbackUrl = u.searchParams.get('callback')
  if (!callbackUrl) throw new Error('no callback in auth URL')
  setTimeout(() => {
    fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: 'fake-supabase-jwt',
        email: 'smoke@example.com',
      }),
    }).catch(() => {})
  }, 50)
  return undefined
}

let exitCode = 0
try {
  const { loginWithBrowser } = await import('../login-browser.js')
  await loginWithBrowser({ timeoutMs: 5_000, openFn: fakeOpen })
  assert.strictEqual(openCalls.length, 1, 'open() should be called once')
  assert.match(openCalls[0], /\/auth\?callback=/, 'should open auth URL with callback param')
  const { config } = await import('../../../utils/config.js')
  assert.strictEqual(config.get('gatewayToken'), 'mint_fake_api_token')
  assert.strictEqual(config.get('email'), 'smoke@example.com')
  console.log('PASS: loginWithBrowser end-to-end (browser stubbed, gateway stubbed)')
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err))
  exitCode = 1
} finally {
  gateway.close()
  rmSync(tmp, { recursive: true, force: true })
}

process.exit(exitCode)
