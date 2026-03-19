import { Link, useLocation } from 'react-router'
import { useAuthStore } from '@/stores/useAuthStore'

export function MainLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  const links = [
    { path: '/', label: '行情看板' },
    { path: '/backtest', label: '回测' },
    { path: '/settings', label: '设置' },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <nav className="flex items-center justify-between px-6 h-12 bg-[var(--color-bg-card)] border-b border-[var(--color-border)] shrink-0 z-50">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 text-[var(--color-text-primary)] font-semibold no-underline">
            <div className="w-6 h-6 bg-[var(--color-accent)] rounded text-white text-xs font-bold flex items-center justify-center">T</div>
            TradeGuard
          </Link>
          <div className="flex gap-1">
            {links.map((l) => (
              <Link
                key={l.path}
                to={l.path}
                className={`px-3 py-1.5 rounded text-sm no-underline transition-colors ${
                  location.pathname === l.path
                    ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-input)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer px-2 py-1 rounded hover:bg-[var(--color-bg-hover)]"
             onClick={logout}>
          <div className="w-7 h-7 rounded-full bg-[rgba(88,166,255,0.12)] text-[var(--color-accent)] flex items-center justify-center text-xs font-semibold">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <span>{user?.username || '用户'}</span>
        </div>
      </nav>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
