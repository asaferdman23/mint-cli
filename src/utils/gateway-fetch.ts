/**
 * Shared fetch helpers for gateway calls from the CLI (auth, quota, account).
 *
 * Centralizes: 10s timeout, error classification (network vs 4xx vs 5xx),
 * human-readable failure messages.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface GatewayFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  /** Pass through an external abort signal; we still wrap with our own timeout. */
  signal?: AbortSignal;
}

/**
 * Fetch with a hard timeout. Throws a clear Error on timeout, network failure,
 * or non-2xx response. Callers that need to inspect status should catch and
 * check `err.status` on the thrown error.
 */
export async function gatewayFetch(url: string, options: GatewayFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options;

  // Compose user-supplied signal with our timeout signal.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(url, { ...init, signal: composed });
  } catch (err) {
    // AbortError can come from either our timeout or the caller's signal.
    // If our timeout fired, give a clearer message.
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new GatewayError(
          `Request timed out after ${timeoutMs / 1000}s. Check your internet connection.`,
          'timeout',
        );
      }
      throw err;
    }
    // Network errors (DNS, ECONNREFUSED, TLS, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    throw new GatewayError(
      `Can't reach the Mint gateway: ${msg}. Check your internet connection.`,
      'network',
    );
  }
}

export type GatewayErrorKind = 'timeout' | 'network' | 'http';

/**
 * Typed error for gateway failures. Lets callers distinguish transient issues
 * (timeout/network — retry) from server errors (http — show server message).
 */
export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly status?: number;

  constructor(message: string, kind: GatewayErrorKind, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Turn a non-OK response into a human-readable message. Caller already knows
 * `!res.ok`; this helper handles the messaging policy centrally.
 */
export async function describeGatewayFailure(res: Response): Promise<GatewayError> {
  const status = res.status;
  let serverMessage = '';
  try {
    const body = await res.clone().json();
    serverMessage = typeof body?.error === 'string' ? body.error : '';
  } catch {
    serverMessage = await res.text().catch(() => '');
  }

  if (status === 401) {
    return new GatewayError(
      'Your session has expired. Run `mint login` to sign in again.',
      'http',
      401,
    );
  }
  if (status === 403) {
    return new GatewayError(
      serverMessage || 'Forbidden. Your account may not have access to this feature.',
      'http',
      403,
    );
  }
  if (status === 404) {
    return new GatewayError(
      serverMessage || 'Not found. The gateway may not support this endpoint.',
      'http',
      404,
    );
  }
  if (status === 429) {
    return new GatewayError(
      serverMessage || 'Rate limited. Run `mint quota` to check your usage.',
      'http',
      429,
    );
  }
  if (status >= 500) {
    return new GatewayError(
      'The gateway is having trouble right now. Try again in a moment.',
      'http',
      status,
    );
  }
  // Other 4xx — forward the server message.
  return new GatewayError(
    serverMessage || `Gateway returned ${status}`,
    'http',
    status,
  );
}
