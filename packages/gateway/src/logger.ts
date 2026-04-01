// Structured JSON logger. Writes to stdout (Railway captures).
// Axiom ingests via Railway log drain — set AXIOM_TOKEN env var in Railway dashboard.

export type LogEvent = Record<string, unknown> & { event: string }

export function log(data: LogEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...data })
  process.stdout.write(line + '\n')
}

export function logError(data: {
  request_id?: string
  session_id?: string
  error_type: string
  message: string
  stack?: string
}): void {
  log({ event: 'error', ...data })
}
