import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Token {
  id: string
  token_prefix: string
  name: string
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

function formatTime(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

export function Tokens() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newToken, setNewToken] = useState<{ token: string; prefix: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const loadTokens = async () => {
    try {
      const res = await api.getTokens()
      setTokens(res.tokens)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTokens()
  }, [])

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const result = await api.createToken(newTokenName || undefined)
      setNewToken(result)
      setShowCreate(false)
      setNewTokenName('')
      await loadTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeToken(id)
      await loadTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token')
    }
  }

  const copyToken = async () => {
    if (!newToken) return
    await navigator.clipboard.writeText(newToken.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (error && loading) {
    return (
      <div className="p-6 rounded-lg bg-red/10 border border-red/30 text-red" role="alert">
        <p>{error}</p>
        <button
          onClick={() => { setError(null); setLoading(true); loadTokens() }}
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
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-surface border border-border-dim animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* New token display */}
      {newToken && (
        <div className="p-4 rounded-lg bg-green/5 border border-green/20">
          <div className="flex items-center gap-2 mb-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sm font-semibold text-green">Token created! Copy it now — you won't see it again.</span>
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-sm text-cyan bg-surface p-3 rounded break-all select-all">
              {newToken.token}
            </code>
            <button
              onClick={copyToken}
              className="px-4 py-2 rounded bg-cyan text-bg font-mono text-sm font-semibold cursor-pointer hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={() => setNewToken(null)}
              className="px-3 py-2 rounded border border-border-hi text-txt-muted text-sm cursor-pointer hover:text-txt-bright transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red/10 border border-red/30 text-red text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Create button / form */}
      {showCreate ? (
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Token name (optional)"
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            className="px-4 py-2.5 rounded-lg bg-surface border border-border-hi text-txt-bright text-sm outline-none focus:border-cyan transition-all placeholder:text-txt-muted"
            autoFocus
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2.5 rounded-lg bg-cyan text-bg font-mono text-sm font-semibold cursor-pointer disabled:opacity-60 hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
          <button
            onClick={() => { setShowCreate(false); setNewTokenName('') }}
            className="px-3 py-2.5 rounded-lg border border-border-hi text-txt-muted text-sm cursor-pointer hover:text-txt-bright transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2.5 rounded-lg bg-cyan text-bg font-mono text-sm font-semibold cursor-pointer hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all"
        >
          + New Token
        </button>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <div className="p-8 rounded-lg border border-border-dim bg-surface text-center">
          <p className="text-txt-muted">No API tokens yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-dim overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border-dim">
                <th className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Prefix
                </th>
                <th className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Last Used
                </th>
                <th className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Created
                </th>
                <th className="text-left px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Status
                </th>
                <th className="text-right px-4 py-3 font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border-dim last:border-b-0 hover:bg-surface-2/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <code className="font-mono text-cyan text-xs">{t.token_prefix}...</code>
                  </td>
                  <td className="px-4 py-3 text-txt-bright">{t.name}</td>
                  <td className="px-4 py-3 text-txt-muted">
                    {t.last_used_at ? formatTime(t.last_used_at) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-txt-muted">{formatTime(t.created_at)}</td>
                  <td className="px-4 py-3">
                    {t.revoked_at ? (
                      <span className="font-mono text-[0.65rem] tracking-wider uppercase px-2 py-0.5 rounded bg-red/10 text-red border border-red/20">
                        revoked
                      </span>
                    ) : (
                      <span className="font-mono text-[0.65rem] tracking-wider uppercase px-2 py-0.5 rounded bg-green/10 text-green border border-green/20">
                        active
                      </span>
                    )}
                  </td>
                  <td className="text-right px-4 py-3">
                    {!t.revoked_at && (
                      <button
                        onClick={() => handleRevoke(t.id)}
                        className="text-xs text-txt-muted hover:text-red transition-colors cursor-pointer bg-transparent border-none"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
