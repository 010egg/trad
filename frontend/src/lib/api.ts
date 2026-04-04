import axios from 'axios'

export const API_BASE_URL = '/api/v1'

export function buildApiHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers)
  const token = localStorage.getItem('access_token')
  if (token) {
    merged.set('Authorization', `Bearer ${token}`)
  }
  return merged
}

export function handleApiUnauthorized(status?: number) {
  if (status !== 401) return
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  window.location.href = '/login'
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
})

// 请求拦截：注入 Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：统一剥离包装和错误处理
api.interceptors.response.use(
  (resp) => {
    const { data } = resp
    // 如果后端返回了标准包装 {"code": 0, "data": ...}
    if (data && typeof data.code === 'number') {
      if (data.code === 0) {
        return data.data
      }
      // 如果 code 不为 0，视为业务错误
      return Promise.reject(new Error(data.message || 'API Business Error'))
    }
    // 如果没有包装，直接返回（兼容旧接口或标准 FastAPI 错误）
    return data
  },
  (err) => {
    handleApiUnauthorized(err.response?.status)
    return Promise.reject(err)
  }
)

export default api
