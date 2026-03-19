import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuthStore } from '@/stores/useAuthStore'

export function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const register = useAuthStore((state) => state.register)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('两次密码不一致'); return }
    if (password.length < 8) { setError('密码至少 8 位'); return }
    try {
      await register(username, email, password)
      navigate('/login')
    } catch {
      setError('注册失败，邮箱可能已被使用')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-[400px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[var(--color-accent)] rounded-lg flex items-center justify-center text-2xl text-white font-bold mx-auto mb-4">T</div>
          <h1 className="text-2xl font-semibold mb-1">创建账号</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">开始使用 TradeGuard</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">用户名</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="输入用户名" />
          </div>
          <div className="mb-4">
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div className="mb-4">
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位" />
          </div>
          <div className="mb-4">
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">确认密码</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入密码" />
          </div>
          {error && <p className="text-sm text-[var(--color-danger)] mb-4">{error}</p>}
          <button type="submit" className="w-full py-3 bg-[var(--color-accent)] text-white rounded font-medium text-base hover:opacity-90 transition cursor-pointer">
            注 册
          </button>
        </form>
        <p className="text-center mt-6 text-sm text-[var(--color-text-secondary)]">
          已有账号？<Link to="/login" className="text-[var(--color-accent)] no-underline hover:underline">登录</Link>
        </p>
      </div>
    </div>
  )
}
