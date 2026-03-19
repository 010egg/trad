import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
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
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
