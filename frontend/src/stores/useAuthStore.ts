import { create } from 'zustand'
import api from '@/lib/api'

interface User {
  id: string
  username: string
  email: string
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  initialized: boolean
  loading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  fetchMe: () => Promise<void>
  initializeAuth: () => Promise<void>
  logout: () => void
}

interface LoginResponse {
  access_token: string
  refresh_token: string
}

function getStorage() {
  const storage = globalThis.localStorage
  if (
    !storage ||
    typeof storage.getItem !== 'function' ||
    typeof storage.setItem !== 'function' ||
    typeof storage.removeItem !== 'function'
  ) {
    return null
  }
  return storage
}

function hasSessionToken() {
  return Boolean(getStorage()?.getItem('access_token'))
}

function persistSession(session: LoginResponse) {
  const storage = getStorage()
  if (!storage) return
  storage.setItem('access_token', session.access_token)
  storage.setItem('refresh_token', session.refresh_token)
}

function clearSession() {
  const storage = getStorage()
  if (!storage) return
  storage.removeItem('access_token')
  storage.removeItem('refresh_token')
}

export const useAuthStore = create<AuthState>((set) => ({
  // 有本地 token 时，先等待 /auth/me 校验完成，再允许受保护页面挂载。
  user: null,
  isAuthenticated: false,
  initialized: !hasSessionToken(),
  loading: false,
  error: null,

  login: async (email, password) => {
    try {
      set({ loading: true, error: null })
      const session: LoginResponse = await api.post('/auth/login', { email, password })
      persistSession(session)

      const user: User = await api.get('/auth/me')
      set({
        user,
        isAuthenticated: true,
        initialized: true,
        loading: false,
      })
    } catch (err: any) {
      clearSession()
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        error: err.response?.data?.detail || 'Login failed',
        loading: false,
      })
      throw err
    }
  },

  register: async (username, email, password) => {
    try {
      set({ loading: true, error: null })
      await api.post('/auth/register', { username, email, password })
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.response?.data?.detail || 'Registration failed', loading: false })
      throw err
    }
  },

  fetchMe: async () => {
    try {
      set({ loading: true, error: null })
      const user: User = await api.get('/auth/me')
      set({
        user,
        isAuthenticated: true,
        initialized: true,
        loading: false,
      })
    } catch (err: any) {
      clearSession()
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        error: err.response?.data?.detail || 'Failed to fetch user',
        loading: false,
      })
      throw err
    }
  },

  initializeAuth: async () => {
    if (!hasSessionToken()) {
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        loading: false,
        error: null,
      })
      return
    }

    try {
      set({
        initialized: false,
        loading: true,
        error: null,
      })
      const user: User = await api.get('/auth/me')
      set({
        user,
        isAuthenticated: true,
        initialized: true,
        loading: false,
        error: null,
      })
    } catch (err: any) {
      clearSession()
      set({
        user: null,
        isAuthenticated: false,
        initialized: true,
        loading: false,
        error: err.response?.data?.detail || 'Failed to fetch user',
      })
    }
  },

  logout: () => {
    clearSession()
    set({
      user: null,
      isAuthenticated: false,
      initialized: true,
      error: null,
    })
  },
}))
