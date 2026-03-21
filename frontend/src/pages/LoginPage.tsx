import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import axios from 'axios'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/useAuthStore'
import { BrandMark, BrandWordmark } from '@/components/BrandMark'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const login = useAuthStore((state) => state.login)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login(email, password)
      try {
        const apiKeys: unknown = await api.get('/account/api-keys')
        const hasApiKey = Array.isArray(apiKeys) && apiKeys.length > 0
        navigate(hasApiKey ? '/' : '/setup')
      } catch {
        navigate('/setup')
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail
        if (typeof detail === 'string' && detail.trim()) {
          setError(detail)
          return
        }
        if (!error.response) {
          setError('无法连接后端，请确认服务是否已启动')
          return
        }
      }
      setError('登录失败，请稍后重试')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-[400px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8">
        <div className="text-center mb-8">
          <BrandMark className="w-16 h-16 mx-auto mb-4" />
          <div className="mb-1 flex justify-center">
            <BrandWordmark className="text-[26px]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">深海交易情报与风控终端</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>
          <div className="mb-4">
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1">密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入密码" />
          </div>
          {error && <p className="text-sm text-[var(--color-danger)] mb-4">{error}</p>}
          <button type="submit" className="w-full py-3 bg-[var(--color-accent)] text-white rounded font-medium text-base hover:opacity-90 transition cursor-pointer">
            登 录
          </button>
        </form>
        <p className="text-center mt-6 text-sm text-[var(--color-text-secondary)]">
          还没有账号？<Link to="/register" className="text-[var(--color-accent)] no-underline hover:underline">注册</Link>
        </p>
      </div>
    </div>
  )
}
