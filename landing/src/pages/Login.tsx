import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
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
          <p className="text-txt-muted text-sm mt-2">Log in to your account</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red/10 border border-red/30 text-red text-sm" role="alert">
              {error}
            </div>
          )}

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
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-surface border border-border-hi text-txt-bright text-sm outline-none focus:border-cyan focus:shadow-[0_0_0_3px_rgba(0,212,255,0.08)] transition-all placeholder:text-txt-muted"
              placeholder="Your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full py-3 rounded-lg bg-cyan text-bg font-mono text-sm font-semibold tracking-wide hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <p className="text-center text-sm text-txt-muted mt-6">
          Don't have an account?{' '}
          <Link to="/signup" className="text-cyan hover:text-cyan-2 transition-colors cursor-pointer">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
