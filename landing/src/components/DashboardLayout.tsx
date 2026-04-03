import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const NAV_ITEMS = [
  {
    path: '/dashboard',
    label: 'Overview',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    path: '/dashboard/tokens',
    label: 'API Tokens',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    path: '/dashboard/history',
    label: 'History',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
]

export function DashboardLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()

  return (
    <div className="min-h-screen flex relative z-1">
      {/* Sidebar */}
      <aside className="w-[240px] bg-surface border-r border-border-dim flex flex-col fixed top-0 bottom-0 left-0 z-40">
        {/* Logo */}
        <div className="h-[60px] flex items-center px-5 border-b border-border-dim">
          <Link to="/" className="no-underline">
            <span className="font-display text-lg font-bold tracking-wide text-txt-bright">
              MINT<span className="text-cyan">.</span>
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-1 transition-colors cursor-pointer no-underline ${
                  active
                    ? 'bg-cyan/10 text-cyan border border-cyan/20'
                    : 'text-txt-muted hover:text-txt-bright hover:bg-surface-2 border border-transparent'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-border-dim">
          <div className="text-sm text-txt-bright truncate mb-1">{user?.email}</div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.65rem] tracking-wider uppercase text-cyan">
              {user?.plan || 'free'}
            </span>
            <button
              onClick={logout}
              className="text-xs text-txt-muted hover:text-red transition-colors cursor-pointer bg-transparent border-none"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-[240px]">
        {/* Header */}
        <header className="h-[60px] flex items-center justify-between px-8 border-b border-border-dim bg-bg/80 backdrop-blur-lg sticky top-0 z-30">
          <h1 className="font-display text-lg font-semibold text-txt-bright">
            {NAV_ITEMS.find((n) => n.path === location.pathname)?.label || 'Dashboard'}
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-txt-muted">{user?.email}</span>
          </div>
        </header>

        {/* Content */}
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
