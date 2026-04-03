import { useState } from 'react'
import { Link } from 'react-router-dom'

const TERMINAL_LINES = [
  { type: 'input', text: '$ mint "Add dark mode toggle to the settings page"' },
  { type: 'info', text: '' },
  { type: 'phase', text: '[scout]    scanning 47 files... matched 6 relevant' },
  { type: 'phase', text: '[architect] planning change across 3 files' },
  { type: 'phase', text: '[builder]  generating diffs... DeepSeek V3 ($0.27/1M)' },
  { type: 'phase', text: '[reviewer] checking quality... Groq 70B ($0.59/1M)' },
  { type: 'info', text: '' },
  { type: 'success', text: 'Done — 3 files changed, $0.003 total, 94% saved vs Sonnet' },
]

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    title: 'Scout \u2192 Architect \u2192 Builder \u2192 Reviewer',
    desc: 'Multi-agent pipeline classifies the task, narrows the file set, plans the change, generates diffs, and reviews the result.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      </svg>
    ),
    title: 'Project Index + MINT.md',
    desc: 'mint init builds a project index, dependency graph, and rules file so tasks start with grounded context.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: 'Tool-Use Agent',
    desc: 'mint agent can read, grep, edit, write, list directories, and run bash with approval modes.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    title: 'Cost Tracking + Gateway',
    desc: 'Tracks spend and savings per request. BYOK providers run directly; the Mint gateway is the shared fallback.',
  },
]

const STEPS = [
  {
    num: '01',
    title: 'Bootstrap project context',
    desc: (
      <>
        Run <code className="font-mono text-cyan text-sm">mint init</code> once. Mint scans the repo, writes{' '}
        <code className="font-mono text-cyan text-sm">.mint/context.json</code>, and generates{' '}
        <code className="font-mono text-cyan text-sm">MINT.md</code> project rules.
      </>
    ),
  },
  {
    num: '02',
    title: 'Run the agent pipeline',
    desc: 'Mint narrows the file set, routes each phase to a cheaper capable model, and runs Scout \u2192 Architect \u2192 Builder \u2192 Reviewer.',
  },
  {
    num: '03',
    title: 'Review and apply locally',
    desc: 'Mint prints unified diffs, tracks savings, and can apply changes from the terminal.',
  },
]

export function Landing() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    // Store in gateway waitlist table (or just log for now — email is captured)
    try {
      await fetch('https://formspree.io/f/mwvwblqk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch { /* fire and forget */ }
    setSubmitted(true)
    setLoading(false)
  }

  return (
    <div className="relative z-1 min-h-screen">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 h-[60px] flex items-center justify-between px-6 border-b border-transparent bg-bg/85 backdrop-blur-lg">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <span className="font-display text-xl font-bold tracking-wide text-txt-bright">
            MINT<span className="text-cyan">.</span>
          </span>
          <span className="font-mono text-[0.6rem] tracking-[0.15em] uppercase px-2 py-0.5 rounded border border-cyan/30 text-cyan bg-cyan/5">
            beta
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-6">
          <a href="#how-it-works" className="text-sm text-txt-muted hover:text-txt-bright transition-colors cursor-pointer">
            How it works
          </a>
          <a href="#features" className="text-sm text-txt-muted hover:text-txt-bright transition-colors cursor-pointer">
            Features
          </a>
          <a
            href="https://github.com/asaferdman23/mint-cli"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-txt-muted hover:text-txt-bright transition-colors cursor-pointer"
          >
            GitHub
          </a>
          <Link
            to="/login"
            className="text-sm text-txt-muted hover:text-txt-bright transition-colors cursor-pointer"
          >
            Log in
          </Link>
          <a
            href="#waitlist"
            className="text-sm font-medium px-4 py-1.5 rounded bg-cyan text-bg hover:bg-cyan/90 transition-colors cursor-pointer"
          >
            Join Waitlist
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-[140px] pb-24 overflow-hidden">
        {/* Grid background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(0,212,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.04) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          }}
        />
        {/* Glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,212,255,0.08) 0%, transparent 70%)',
          }}
        />

        <div className="max-w-[1160px] mx-auto px-6 relative z-1">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="font-mono text-[0.7rem] tracking-[0.2em] uppercase text-cyan mb-6">
                <span className="text-txt-muted">// </span>agentic coding cli &middot; active beta
              </p>
              <h1 className="font-display text-4xl md:text-5xl lg:text-[3.2rem] font-bold leading-tight text-txt-bright mb-6">
                Talk to your code.
                <br />
                Agents do the work.
                <br />
                <span className="text-cyan">In parallel.</span>
              </h1>
              <p className="text-txt-muted text-lg font-light max-w-[520px] mb-8 leading-relaxed">
                Mint is an agentic coding CLI. Have a conversation, and Mint dispatches parallel workers,
                subagents, and a Scout &rarr; Architect &rarr; Builder &rarr; Reviewer pipeline &mdash; all
                with cost-aware model routing.
              </p>
              <div className="flex flex-wrap gap-3 mb-8">
                <a
                  href="#waitlist"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-cyan text-bg font-mono text-sm font-semibold tracking-wide hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all cursor-pointer no-underline"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  Join the Waitlist
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border-hi text-txt font-mono text-sm hover:border-txt-muted hover:text-txt-bright transition-all cursor-pointer no-underline"
                >
                  See how it works &rarr;
                </a>
              </div>
              <div className="flex gap-8">
                <div>
                  <div className="font-display text-2xl font-bold text-cyan">4</div>
                  <div className="font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">pipeline phases</div>
                </div>
                <div>
                  <div className="font-display text-2xl font-bold text-orange">7</div>
                  <div className="font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">built-in code tools</div>
                </div>
                <div>
                  <div className="font-display text-2xl font-bold text-txt-bright">init</div>
                  <div className="font-mono text-[0.65rem] tracking-wider uppercase text-txt-muted">index + rules</div>
                </div>
              </div>
            </div>

            {/* Terminal */}
            <div className="rounded-lg border border-border-dim overflow-hidden bg-surface shadow-2xl">
              <div className="flex items-center gap-2 px-4 py-3 bg-surface-2 border-b border-border-dim">
                <div className="w-3 h-3 rounded-full bg-red/80" />
                <div className="w-3 h-3 rounded-full bg-orange/80" />
                <div className="w-3 h-3 rounded-full bg-green/80" />
                <span className="ml-2 font-mono text-[0.7rem] text-txt-muted">
                  mint-cli &mdash; ~/projects/my-app
                </span>
              </div>
              <div className="p-5 font-mono text-[0.78rem] leading-relaxed min-h-[260px]">
                {TERMINAL_LINES.map((line, i) => (
                  <div key={i} className={`${line.type === 'info' ? 'h-3' : ''}`}>
                    {line.type === 'input' && <span className="text-txt-muted">{line.text}</span>}
                    {line.type === 'phase' && <span className="text-cyan">{line.text}</span>}
                    {line.type === 'success' && (
                      <span className="text-green font-semibold">{line.text}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 relative">
        <div className="max-w-[1160px] mx-auto px-6">
          <p className="font-mono text-[0.7rem] tracking-[0.2em] uppercase text-cyan mb-3">
            <span className="text-txt-muted">// </span>how it works
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-txt-bright mb-12">
            Index. Search. Plan.
            <br />
            Build. Review.
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((step) => (
              <div
                key={step.num}
                className="p-6 rounded-lg border border-border-dim bg-surface hover:border-border-hi transition-colors"
              >
                <div className="font-mono text-[0.7rem] text-cyan mb-3">{step.num}</div>
                <h3 className="font-display text-lg font-semibold text-txt-bright mb-2">{step.title}</h3>
                <p className="text-sm text-txt-muted leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 relative bg-surface">
        <div className="max-w-[1160px] mx-auto px-6">
          <p className="font-mono text-[0.7rem] tracking-[0.2em] uppercase text-cyan mb-3">
            <span className="text-txt-muted">// </span>features
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-txt-bright mb-12">
            Built around the
            <br />
            current beta surface.
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-lg border border-border-dim bg-surface-2 hover:border-border-hi transition-colors"
              >
                <div className="mb-4">{f.icon}</div>
                <h3 className="font-display text-base font-semibold text-txt-bright mb-2">{f.title}</h3>
                <p className="text-sm text-txt-muted leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="py-24 relative overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(0,212,255,0.07) 0%, transparent 70%)' }}
        />
        <div className="max-w-[560px] mx-auto px-6 text-center relative z-1">
          <span className="inline-block font-mono text-[0.65rem] tracking-[0.2em] uppercase text-cyan border border-cyan/30 bg-cyan/5 px-3 py-1 rounded mb-6">
            // beta updates
          </span>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-txt-bright mb-4">
            Get in early.<br />
            <span className="text-cyan">We'll let you know.</span>
          </h2>
          <p className="text-txt-muted font-light leading-relaxed mb-8">
            Mint already ships indexing, routing, a multi-agent pipeline, and beta diff apply.
            Join the list for release notes, roadmap updates, and early access.
          </p>

          {submitted ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-12 h-12 rounded-full bg-green/15 border border-green/30 flex items-center justify-center text-green text-xl animate-[scale-in_0.3s_ease-out]">✓</div>
              <h3 className="text-txt-bright font-display text-xl font-semibold">You're in!</h3>
              <p className="text-txt-muted text-sm leading-relaxed max-w-[380px]">
                Thanks for signing up. We'll be in touch soon with early access details and next steps.
              </p>
              <div className="flex items-center gap-2 mt-1 px-4 py-2 rounded border border-cyan/20 bg-cyan/5">
                <span className="text-cyan text-xs font-mono">{email}</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleWaitlist} className="w-full">
              <div className="flex gap-2 p-1.5 rounded-lg border border-border-hi bg-surface focus-within:border-cyan/50 transition-colors">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="email"
                  className="flex-1 bg-transparent px-3 py-2 text-sm text-txt-bright placeholder:text-txt-muted outline-none font-mono"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded bg-cyan text-bg font-mono text-sm font-semibold hover:bg-cyan/90 disabled:opacity-60 transition-all whitespace-nowrap"
                >
                  {loading ? '...' : 'Join Beta Updates →'}
                </button>
              </div>
              <p className="text-txt-muted text-xs mt-3">← roadmap drops · beta invites · unsubscribe anytime</p>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-dim py-8">
        <div className="max-w-[1160px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-display text-sm text-txt-muted">
            MINT<span className="text-cyan">.</span>{' '}
            <span className="text-txt-muted/60">&copy; {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6">
            <a
              href="https://github.com/asaferdman23/mint-cli"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-txt-muted hover:text-cyan transition-colors cursor-pointer"
            >
              GitHub
            </a>
            <Link to="/login" className="text-sm text-txt-muted hover:text-cyan transition-colors cursor-pointer">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
