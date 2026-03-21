import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/useAuthStore'

// 静态导入（页面 bundle 很小，切换无感知）
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { SetupPage } from '@/pages/SetupPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { IntelPage } from '@/pages/IntelPage'
import { BacktestPage } from '@/pages/BacktestPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { IntelAiDialog } from '@/features/intel/IntelAiDialog'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

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
          <DashboardPage />
        </PageSlot>
      )}
      {mounted.has('/backtest') && (
        <PageSlot active={active === '/backtest'}>
          <BacktestPage />
        </PageSlot>
      )}
      {mounted.has('/intel') && (
        <PageSlot active={active === '/intel'}>
          <IntelPage />
        </PageSlot>
      )}
      {mounted.has('/settings') && (
        <PageSlot active={active === '/settings'}>
          <SettingsPage />
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
      {children}
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
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/setup" element={<ProtectedRoute><SetupPage /></ProtectedRoute>} />
        <Route path="/*" element={<ProtectedRoute><KeepAliveRoutes /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
