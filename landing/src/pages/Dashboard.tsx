import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

interface Stats {
  total_requests: number
  total_cost: number
  total_input_tok: number
  total_output_tok: number
}

interface Session {
  session_id: string
  request_count: number
  total_cost: number
  first_ts: string
  last_ts: string
}

function StatCard({
  label,
  value,
  accent = 'cyan',
}: {
  label: string
  value: string
  accent?: 'cyan' | 'orange' | 'green'
}) {
  const accentClasses = {
    cyan: 'border-cyan/20 bg-cyan/5',
    orange: 'border-orange/20 bg-orange/5',
    green: 'border-green/20 bg-green/5',
  }
  const valueClasses = {
    cyan: 'text-cyan',
    orange: 'text-orange',
    green: 'text-green',
  }

  return (
    <div className={`p-5 rounded-lg border ${accentClasses[accent]} transition-colors`}>
      <div className="font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted mb-2">
        {label}
      </div>
      <div className={`font-display text-2xl font-bold ${valueClasses[accent]}`}>{value}</div>
    </div>
  )
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, sessionsRes] = await Promise.all([
          api.getStats(),
          api.getSessions(10),
        ])
        setStats(statsRes.stats)
        setSessions(sessionsRes.sessions)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (error) {
    return (
      <div className="p-6 rounded-lg bg-red/10 border border-red/30 text-red" role="alert">
        <p className="font-semibold mb-1">Failed to load dashboard</p>
        <p className="text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 px-4 py-2 rounded bg-red/20 text-red text-sm cursor-pointer border border-red/30 hover:bg-red/30 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-live="polite" aria-busy="true">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-surface border border-border-dim animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-surface border border-border-dim animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Requests"
          value={stats?.total_requests.toLocaleString() || '0'}
          accent="cyan"
        />
        <StatCard
          label="Total Cost"
          value={formatCost(stats?.total_cost || 0)}
          accent="orange"
        />
        <StatCard
          label="Input Tokens"
          value={formatTokens(stats?.total_input_tok || 0)}
          accent="green"
        />
        <StatCard
          label="Output Tokens"
          value={formatTokens(stats?.total_output_tok || 0)}
          accent="cyan"
        />
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link
          to="/dashboard/tokens"
          className="px-4 py-2 rounded-lg border border-border-hi text-txt font-mono text-sm hover:border-cyan hover:text-cyan transition-colors cursor-pointer no-underline"
        >
          Manage Tokens
        </Link>
        <Link
          to="/dashboard/history"
          className="px-4 py-2 rounded-lg border border-border-hi text-txt font-mono text-sm hover:border-cyan hover:text-cyan transition-colors cursor-pointer no-underline"
        >
          View History
        </Link>
      </div>

      {/* Recent Sessions */}
      <div>
        <h2 className="font-display text-lg font-semibold text-txt-bright mb-4">Recent Sessions</h2>
        {sessions.length === 0 ? (
          <div className="p-8 rounded-lg border border-border-dim bg-surface text-center">
            <p className="text-txt-muted">No sessions yet. Start using Mint to see activity here.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border-dim overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 border-b border-border-dim">
                  <th className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                    Session
                  </th>
                  <th className="text-right px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                    Requests
                  </th>
                  <th className="text-right px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                    Cost
                  </th>
                  <th className="text-right px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                    Last Active
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.session_id}
                    className="border-b border-border-dim last:border-b-0 hover:bg-surface-2/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-cyan text-xs">
                        {s.session_id.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-txt-bright">
                      {s.request_count}
                    </td>
                    <td className="text-right px-4 py-3 font-mono text-orange">
                      {formatCost(s.total_cost)}
                    </td>
                    <td className="text-right px-4 py-3 text-txt-muted">
                      {formatTime(s.last_ts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
