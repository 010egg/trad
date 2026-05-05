import { useEffect, useRef } from 'react'
import { useMarketStore } from '@/stores/useMarketStore'

const FALLBACK_POLL_MS = 2000
const FALLBACK_IDLE_MS = 5000
const RECONNECT_IDLE_MS = 8000
const RECONNECT_THROTTLE_MS = 4000

function buildWsCandidates() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const candidates = [`${protocol}://${window.location.host}/ws/market`]
  const isLocalDevHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname)

  if (isLocalDevHost && window.location.port.startsWith('517')) {
    candidates.push(`${protocol}://${window.location.hostname}:8000/ws/market`)
    candidates.push(`${protocol}://127.0.0.1:8000/ws/market`)
    candidates.push(`${protocol}://localhost:8000/ws/market`)
  }

  return [...new Set(candidates)]
}

export function useMarketWebSocket(enabled = true) {
  const symbol = useMarketStore((state) => state.symbol)
  const interval = useMarketStore((state) => state.interval)
  const updateKline = useMarketStore((state) => state.updateKline)
  const syncLatestKlines = useMarketStore((state) => state.syncLatestKlines)
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(500)
  const lastRealtimeRef = useRef(0)
  const lastReconnectRef = useRef(0)
  const reconnectReasonRef = useRef<'close' | 'stale'>('close')
  const candidateIndexRef = useRef(0)
  const symbolRef = useRef(symbol)
  const intervalRef = useRef(interval)

  // 切换 symbol/interval 时：发送新订阅消息，不重新建立连接
  useEffect(() => {
    symbolRef.current = symbol
    intervalRef.current = interval
    lastRealtimeRef.current = 0

    if (!enabled) return

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'subscribe', symbol, interval }))
    }

    void syncLatestKlines(symbol, interval)
  }, [enabled, symbol, interval, syncLatestKlines])

  // WebSocket 连接只建立一次，断线后自动重连
  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close()
      wsRef.current = null
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const wsCandidates = buildWsCandidates()

    const scheduleReconnect = (reason: 'close' | 'stale') => {
      const now = Date.now()
      if (now - lastReconnectRef.current < RECONNECT_THROTTLE_MS) {
        return
      }

      lastReconnectRef.current = now
      reconnectReasonRef.current = reason
      lastRealtimeRef.current = 0
      wsRef.current?.close()
    }

    const pollTimer = setInterval(() => {
      const inactiveMs = Date.now() - lastRealtimeRef.current
      if (lastRealtimeRef.current === 0 || inactiveMs >= FALLBACK_IDLE_MS) {
        void syncLatestKlines(symbolRef.current, intervalRef.current)
      }
      if (inactiveMs >= RECONNECT_IDLE_MS) {
        scheduleReconnect('stale')
      }
    }, FALLBACK_POLL_MS)

    function connect() {
      if (cancelled) return

      const target = wsCandidates[candidateIndexRef.current] || wsCandidates[0]
      const ws = new WebSocket(target)
      wsRef.current = ws

      ws.onopen = () => {
        console.log(`[WS] Connected: ${target}`)
        backoffRef.current = 500
        ws.send(JSON.stringify({ action: 'subscribe', symbol: symbolRef.current, interval: intervalRef.current }))
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'subscribed') {
            console.log(`[WS] Subscribed to ${msg.symbol} ${msg.interval}`)
            return
          }
          if (msg.type === 'kline') {
            lastRealtimeRef.current = Date.now()
            candidateIndexRef.current = 0
            const { symbol: msgSymbol, ...kline } = msg.data
            // 只有当推送的 symbol 与当前 refs 中的 symbol 匹配时才更新
            if (msgSymbol && msgSymbol !== symbolRef.current) return

            updateKline(kline, msgSymbol)
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onclose = () => {
        if (cancelled) return
        if (reconnectReasonRef.current === 'stale' && wsCandidates.length > 1) {
          candidateIndexRef.current = (candidateIndexRef.current + 1) % wsCandidates.length
        }
        console.log(`[WS] Disconnected, reconnecting in ${backoffRef.current / 1000}s`)
        timer = setTimeout(() => {
          reconnectReasonRef.current = 'close'
          backoffRef.current = Math.min(backoffRef.current * 2, 5000)
          connect()
        }, backoffRef.current)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearInterval(pollTimer)
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, updateKline, syncLatestKlines])
}
