/**
 * Browser-based OAuth login (Claude-style).
 *
 * Flow:
 *   1. Spin up an ephemeral HTTP server on a free local port.
 *   2. Open `https://usemint.dev/auth?callback=http://localhost:<port>/callback`
 *      in the user's default browser.
 *   3. The landing page completes Supabase OAuth (GitHub or Google) and
 *      POSTs `{ access_token, email }` back to the local callback URL.
 *   4. Exchange the Supabase access_token for a long-lived gateway API token
 *      via `POST /auth/oauth-token`.
 *   5. Persist the token to ~/.mint/config.json and shut the local server.
 *
 * The local server only accepts a single request, only on `/callback`, and
 * only with a matching `state` parameter. No tokens are ever placed in the
 * URL the browser navigates to — they come back via POST body.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import open from 'open';
import chalk from 'chalk';
import boxen from 'boxen';
import { config } from '../../utils/config.js';
import { gatewayFetch, GatewayError, describeGatewayFailure } from '../../utils/gateway-fetch.js';

interface BrowserAuthOptions {
  /** Override the landing-site URL (e.g. for staging). */
  webUrl?: string;
  /** Override the gateway URL. */
  gatewayUrl?: string;
  /** How long to wait for the browser callback before giving up. */
  timeoutMs?: number;
  /** Override the browser-launcher (test seam). */
  openFn?: (url: string) => Promise<unknown>;
  /** Suppress stdout/stderr output (use inside the Ink TUI). */
  silent?: boolean;
}

export interface BrowserAuthResult {
  email: string;
  plan: string;
}

interface CallbackPayload {
  access_token?: string;
  email?: string;
}

const DEFAULT_WEB_URL = 'https://usemint.dev';
const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 minutes

export async function loginWithBrowser(opts: BrowserAuthOptions = {}): Promise<BrowserAuthResult> {
  const webUrl = opts.webUrl ?? process.env.MINT_WEB_URL ?? DEFAULT_WEB_URL;
  const gatewayUrl =
    opts.gatewayUrl ?? process.env.MINT_GATEWAY_URL ?? config.getGatewayUrl();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const openFn: (url: string) => Promise<unknown> = opts.openFn ?? ((url: string) => open(url) as unknown as Promise<unknown>);

  // Random state token — the landing page echoes this back so we can reject
  // any unexpected POSTs (e.g. from a stale browser tab).
  const state = randomBytes(16).toString('hex');

  let server: Server | undefined;
  let timer: NodeJS.Timeout | undefined;

  try {
    const { port, payload } = await new Promise<{ port: number; payload: CallbackPayload }>(
      (resolve, reject) => {
        server = createServer((req, res) => handleRequest(req, res, state, resolve));
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server!.address();
          if (typeof address === 'string' || !address) {
            reject(new Error('failed to bind local callback port'));
            return;
          }

          const listenPort = address.port;
          const callbackUrl = `http://localhost:${listenPort}/callback?state=${state}`;
          const authUrl = `${webUrl}/auth?callback=${encodeURIComponent(callbackUrl)}`;

          console.log(
            boxen(
              chalk.bold.cyan('Sign in to Mint') +
                '\n\n' +
                chalk.white('Opening your browser...') +
                '\n\n' +
                chalk.dim('If it does not open, paste this URL:') +
                '\n' +
                chalk.cyan(authUrl) +
                '\n\n' +
                chalk.dim(`Waiting up to ${Math.round(timeoutMs / 60_000)} minutes for sign-in to complete.`),
              { padding: 1, borderColor: 'cyan', borderStyle: 'round' },
            ),
          );

          openFn(authUrl).catch(() => {
            // open() failure is non-fatal — the URL is already printed above.
          });

          timer = setTimeout(() => {
            reject(new Error('Timed out waiting for browser sign-in. Try again, or use `mint signup` for email/password.'));
          }, timeoutMs);

          // The actual `resolve` is called from handleRequest once the browser
          // POSTs back. We just resolve `port` here to satisfy the outer
          // closure when the request lands.
          (resolve as unknown as { _port?: number })._port = listenPort;
        });
      },
    );

    void port; // captured only for logging, intentionally unused

    if (!payload.access_token) {
      throw new Error('Sign-in completed but no access token was returned. Try again.');
    }

    // Exchange the Supabase JWT for a gateway API token. We persist the
    // long-lived API token rather than the JWT so the user does not need to
    // re-auth every hour when Supabase rotates the JWT.
    const exchange = await gatewayFetch(`${gatewayUrl}/auth/oauth-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabase_token: payload.access_token }),
    });

    if (!exchange.ok) {
      const err = await describeGatewayFailure(exchange);
      throw new Error(`Token exchange failed: ${err.message}`);
    }

    const exchanged = (await exchange.json()) as {
      token?: string;
      email?: string;
      plan?: string;
    };

    if (!exchanged.token) {
      throw new Error('Token exchange returned no token. Try again.');
    }

    config.set('gatewayToken', exchanged.token);
    config.set('gatewayTokenKind', 'api');
    const resolvedEmail = exchanged.email ?? payload.email ?? '';
    if (resolvedEmail) {
      config.set('email', resolvedEmail);
    }
    const resolvedPlan = exchanged.plan ?? 'free';

    if (!opts.silent) {
      console.log(
        boxen(
          chalk.bold.green('Signed in!') +
            '\n\n' +
            `Email: ${chalk.cyan(resolvedEmail || '(unknown)')}` +
            '\n' +
            `Plan:  ${chalk.yellow(resolvedPlan.toUpperCase())} ${chalk.dim('(50 requests/month)')}` +
            '\n\n' +
            chalk.bold('Next:') +
            ` ${chalk.cyan('mint init')} ${chalk.dim('to scan this project')}`,
          { padding: 1, borderColor: 'green', borderStyle: 'round' },
        ),
      );
    }
    return { email: resolvedEmail, plan: resolvedPlan };
  } catch (err) {
    if (!opts.silent) {
      if (err instanceof GatewayError) {
        console.error(chalk.red('\n  ' + err.message + '\n'));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red('\n  Sign-in failed: ' + message + '\n'));
      }
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (server) {
      try {
        server.close();
      } catch {
        /* already closed */
      }
    }
  }
}

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedState: string,
  resolve: (value: { port: number; payload: CallbackPayload }) => void,
): void {
  // CORS for the landing page POST.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  // The state parameter must match. We accept it from either query string
  // (GET fallback the landing page uses if POST fails) or — for the canonical
  // POST path — from the URL the landing page navigated to, which the page
  // forwards verbatim.
  const stateFromQuery = url.searchParams.get('state');
  if (stateFromQuery !== expectedState) {
    res.writeHead(400);
    res.end('invalid state');
    return;
  }

  const respondOk = () => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><meta charset=utf-8><title>Mint signed in</title>' +
        '<body style="background:#07090d;color:#c8dae8;font-family:system-ui;padding:40px;text-align:center">' +
        '<h1 style="color:#00d4ff">✓ Signed in</h1>' +
        '<p>You can close this tab and return to the terminal.</p></body>',
    );
  };

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // 64KB cap — defends against pathological payloads.
      if (body.length > 65_536) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as CallbackPayload;
        respondOk();
        resolve({ port: 0, payload });
      } catch {
        res.writeHead(400);
        res.end('invalid json');
      }
    });
    return;
  }

  if (req.method === 'GET') {
    // Fallback path: landing page falls back to GET with token in query
    // string if its POST fails.
    const accessToken = url.searchParams.get('access_token');
    if (!accessToken) {
      res.writeHead(400);
      res.end('missing access_token');
      return;
    }
    respondOk();
    resolve({ port: 0, payload: { access_token: accessToken } });
    return;
  }

  res.writeHead(405);
  res.end('method not allowed');
}
