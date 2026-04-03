import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface HistoryItem {
  id: string
  session_id: string
  ts: string
  model: string
  provider: string
  task_type: string
  input_tok: number
  output_tok: number
  cost_actual: number
  cost_sonnet: number
  latency_ms: number
  error: string | null
}

type SortField = 'ts' | 'model' | 'provider' | 'cost_actual' | 'latency_ms'
type SortDir = 'asc' | 'desc'

function formatTime(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts))
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(5)}`
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

export function History() {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('ts')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [providerFilter, setProviderFilter] = useState<string>('all')

  useEffect(() => {
    async function load() {
      try {
        const res = await api.getHistory(100)
        setHistory(res.history)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load history')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const providers = Array.from(new Set(history.map((h) => h.provider))).sort()

  const filtered = history.filter(
    (h) => providerFilter === 'all' || h.provider === providerFilter
  )

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortField === 'ts') return mul * (new Date(a.ts).getTime() - new Date(b.ts).getTime())
    if (sortField === 'model') return mul * a.model.localeCompare(b.model)
    if (sortField === 'provider') return mul * a.provider.localeCompare(b.provider)
    if (sortField === 'cost_actual') return mul * (a.cost_actual - b.cost_actual)
    if (sortField === 'latency_ms') return mul * (a.latency_ms - b.latency_ms)
    return 0
  })

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      onClick={() => handleSort(field)}
      className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted cursor-pointer hover:text-txt-bright transition-colors select-none"
    >
      {label}
      {sortField === field && (
        <span className="ml-1 text-cyan">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
      )}
    </th>
  )

  if (error) {
    return (
      <div className="p-6 rounded-lg bg-red/10 border border-red/30 text-red" role="alert">
        <p>{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 px-4 py-2 rounded bg-red/20 text-red text-sm cursor-pointer border border-red/30"
        >
          Retry
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-live="polite" aria-busy="true">
        <div className="h-10 w-48 rounded-lg bg-surface border border-border-dim animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-surface border border-border-dim animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <label className="text-sm text-txt-muted">
          Provider:
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="ml-2 px-3 py-1.5 rounded bg-surface border border-border-hi text-txt-bright text-sm outline-none focus:border-cyan transition-all cursor-pointer"
          >
            <option value="all">All</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <span className="text-sm text-txt-muted">
          {sorted.length} request{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="p-8 rounded-lg border border-border-dim bg-surface text-center">
          <p className="text-txt-muted">No request history yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-dim overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-surface-2 border-b border-border-dim">
                <SortHeader field="ts" label="Time" />
                <SortHeader field="model" label="Model" />
                <SortHeader field="provider" label="Provider" />
                <th className="text-right px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Tokens
                </th>
                <SortHeader field="cost_actual" label="Cost" />
                <th className="text-right px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Savings
                </th>
                <SortHeader field="latency_ms" label="Latency" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const savings =
                  h.cost_sonnet > 0
                    ? Math.round(((h.cost_sonnet - h.cost_actual) / h.cost_sonnet) * 100)
                    : 0
                return (
                  <tr
                    key={h.id}
                    className={`border-b border-border-dim last:border-b-0 hover:bg-surface-2/50 transition-colors ${
                      h.error ? 'bg-red/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-txt-muted whitespace-nowrap">
                      {formatTime(h.ts)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-cyan text-xs">{h.model}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-txt-muted text-xs">{h.provider}</span>
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-xs text-txt-muted whitespace-nowrap">
                      {formatTokens(h.input_tok)} / {formatTokens(h.output_tok)}
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-orange text-xs">
                      {formatCost(h.cost_actual)}
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-xs">
                      {savings > 0 ? (
                        <span className="text-green">{savings}%</span>
                      ) : (
                        <span className="text-txt-muted">-</span>
                      )}
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-xs text-txt-muted">
                      {h.latency_ms}ms
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
