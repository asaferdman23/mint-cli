import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiToken, setApiToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      const token = await signup(email, password, name || undefined)
      setApiToken(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  const copyToken = async () => {
    if (!apiToken) return
    await navigator.clipboard.writeText(apiToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Show token screen after successful signup
  if (apiToken) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 relative z-1">
        <div className="w-full max-w-[480px] text-center">
          <div className="w-12 h-12 rounded-full bg-green/20 border border-green/40 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="font-display text-2xl font-bold text-txt-bright mb-2">Account created!</h2>
          <p className="text-txt-muted text-sm mb-6">
            Here is your API token. Copy it now — you won't see it again.
          </p>

          <div className="p-4 rounded-lg bg-surface border border-border-hi mb-4">
            <p className="font-mono text-sm text-cyan break-all select-all">{apiToken}</p>
          </div>

          <div className="flex gap-3 justify-center mb-6">
            <button
              onClick={copyToken}
              className="px-6 py-2.5 rounded-lg bg-cyan text-bg font-mono text-sm font-semibold tracking-wide hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all cursor-pointer"
            >
              {copied ? 'Copied!' : 'Copy Token'}
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-2.5 rounded-lg border border-border-hi text-txt font-mono text-sm hover:border-txt-muted hover:text-txt-bright transition-all cursor-pointer"
            >
              Go to Dashboard
            </button>
          </div>

          <div className="p-3 rounded-lg bg-surface-2 border border-border-dim">
            <p className="font-mono text-[0.7rem] text-txt-muted">
              Use this token in the CLI:{' '}
              <code className="text-cyan">mint login</code> or set{' '}
              <code className="text-cyan">MINT_API_TOKEN</code> env var
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative z-1">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-block no-underline">
            <span className="font-display text-2xl font-bold tracking-wide text-txt-bright">
              MINT<span className="text-cyan">.</span>
            </span>
          </Link>
          <p className="text-txt-muted text-sm mt-2">Create your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red/10 border border-red/30 text-red text-sm" role="alert">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm text-txt-muted mb-1.5 font-mono text-xs tracking-wider uppercase">
              Name <span className="text-txt-muted/50">(optional)</span>
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-surface border border-border-hi text-txt-bright text-sm outline-none focus:border-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)] transition-all placeholder:text-txt-muted"
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm text-txt-muted mb-1.5 font-mono text-xs tracking-wider uppercase">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-surface border border-border-hi text-txt-bright text-sm outline-none focus:border-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)] transition-all placeholder:text-txt-muted"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-txt-muted mb-1.5 font-mono text-xs tracking-wider uppercase">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-surface border border-border-hi text-txt-bright text-sm outline-none focus:border-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)] transition-all placeholder:text-txt-muted"
              placeholder="At least 8 characters"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full py-3 rounded-lg bg-cyan text-bg font-mono text-sm font-semibold tracking-wide hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-txt-muted mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-cyan hover:text-cyan-2 transition-colors cursor-pointer">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
