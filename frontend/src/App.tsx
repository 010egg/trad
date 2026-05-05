import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'
import { PageActivityProvider } from '@/hooks/usePageActivity'

import { IntelAiDialog } from '@/features/intel/IntelAiDialog'

const LoginPage = lazy(async () => {
  const module = await import('@/pages/LoginPage')
  return { default: module.LoginPage }
})

const RegisterPage = lazy(async () => {
  const module = await import('@/pages/RegisterPage')
  return { default: module.RegisterPage }
})

const SetupPage = lazy(async () => {
  const module = await import('@/pages/SetupPage')
  return { default: module.SetupPage }
})

const DashboardPage = lazy(async () => {
  const module = await import('@/pages/DashboardPage')
  return { default: module.DashboardPage }
})

const IntelPage = lazy(async () => {
  const module = await import('@/pages/IntelPage')
  return { default: module.IntelPage }
})

const BacktestPage = lazy(async () => {
  const module = await import('@/pages/BacktestPage')
  return { default: module.BacktestPage }
})

const SettingsPage = lazy(async () => {
  const module = await import('@/pages/SettingsPage')
  return { default: module.SettingsPage }
})

function AppBootSplash() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] flex items-center justify-center text-sm">
      正在加载...
    </div>
  )
}

function RouteChunkFallback() {
  return (
    <div className="h-full bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] flex items-center justify-center text-sm">
      正在加载...
    </div>
  )
}

function PageChunk({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteChunkFallback />}>
      {children}
    </Suspense>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const initialized = useAuthStore((state) => state.initialized)

  if (!initialized) {
    return <AppBootSplash />
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />
}

// 主页面 keep-alive：首次访问时挂载，之后保持不销毁，切换只改变可见性
// 使用 visibility 而非 display:none，保留 DOM 尺寸让图表不需要重新计算
const KEEPALIVE_PATHS = ['/', '/intel', '/backtest', '/settings'] as const
type KeepalivePath = typeof KEEPALIVE_PATHS[number]

function KeepAliveRoutes() {
  const location = useLocation()
  const [mounted, setMounted] = useState<Set<KeepalivePath>>(() => {
    const initial = location.pathname as KeepalivePath
    return new Set(KEEPALIVE_PATHS.includes(initial) ? [initial] : [])
  })

  useEffect(() => {
    const path = location.pathname as KeepalivePath
    if (!KEEPALIVE_PATHS.includes(path)) return
    setMounted(prev => {
      if (prev.has(path)) return prev
      return new Set([...prev, path])
    })
  }, [location.pathname])

  const active = location.pathname

  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      {mounted.has('/') && (
        <PageSlot active={active === '/'}>
          <PageChunk>
            <DashboardPage />
          </PageChunk>
        </PageSlot>
      )}
      {mounted.has('/backtest') && (
        <PageSlot active={active === '/backtest'}>
          <PageChunk>
            <BacktestPage />
          </PageChunk>
        </PageSlot>
      )}
      {mounted.has('/intel') && (
        <PageSlot active={active === '/intel'}>
          <PageChunk>
            <IntelPage />
          </PageChunk>
        </PageSlot>
      )}
      {mounted.has('/settings') && (
        <PageSlot active={active === '/settings'}>
          <PageChunk>
            <SettingsPage />
          </PageChunk>
        </PageSlot>
      )}
      <IntelAiDialog />
    </div>
  )
}

function PageSlot({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0,
        contentVisibility: active ? 'visible' : 'auto',
      }}
    >
      <PageActivityProvider active={active}>
        {children}
      </PageActivityProvider>
    </div>
  )
}

export function App() {
  const initializeAuth = useAuthStore((state) => state.initializeAuth)

  useEffect(() => {
    void initializeAuth()
  }, [initializeAuth])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PageChunk><LoginPage /></PageChunk>} />
        <Route path="/register" element={<PageChunk><RegisterPage /></PageChunk>} />
        <Route path="/setup" element={<ProtectedRoute><PageChunk><SetupPage /></PageChunk></ProtectedRoute>} />
        <Route path="/*" element={<ProtectedRoute><KeepAliveRoutes /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
