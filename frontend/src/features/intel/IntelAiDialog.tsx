import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { API_BASE_URL, buildApiHeaders, handleApiUnauthorized } from '@/lib/api'
import { useIntelAiStore } from '@/stores/useIntelAiStore'

type IntelAiMessage = {
  role: 'user' | 'assistant'
  content: string
}

type IntelAiSessions = Record<string, IntelAiMessage[]>

type IntelAiStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; reply: string; model: string; latency_ms: number }
  | { type: 'error'; detail: string }

const GLOBAL_SESSION_KEY = '__global__'

const INITIAL_ANALYSIS_PROMPT = '请从交易角度详细分析这条情报，说明核心影响逻辑、受影响标的、持续时间、风险点，以及接下来应该重点验证的信号。'

const ITEM_QUICK_PROMPTS = [
  '给我一个 3 句版结论',
  '这条消息更利多还是利空，为什么？',
  '如果要交易，盯哪些确认信号？',
]

const GLOBAL_QUICK_PROMPTS = [
  '今天市场最该盯什么？',
  '给我一个当前风险清单',
  '现在更适合防守还是进攻？',
]

function parseIntelAiStreamEvent(rawEvent: string): IntelAiStreamEvent | null {
  let eventType = 'message'
  const dataLines: string[] = []

  for (const line of rawEvent.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim() || 'message'
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return null

  const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>
  if (eventType === 'delta') {
    return { type: 'delta', content: String(payload.content || '') }
  }
  if (eventType === 'done') {
    return {
      type: 'done',
      reply: String(payload.reply || ''),
      model: String(payload.model || ''),
      latency_ms: Number(payload.latency_ms || 0),
    }
  }
  if (eventType === 'error') {
    return { type: 'error', detail: String(payload.detail || 'AI 分析失败') }
  }
  return null
}

async function streamIntelAiReply(
  path: string,
  payload: { question: string; history: IntelAiMessage[] },
  signal: AbortSignal,
  onEvent: (event: IntelAiStreamEvent) => void,
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildApiHeaders({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify(payload),
    signal,
  })

  handleApiUnauthorized(response.status)
  if (!response.ok) {
    let detail = 'AI 分析失败'
    try {
      const body = await response.json()
      detail = String(body?.detail || body?.message || detail)
    } catch {
      const text = await response.text()
      if (text.trim()) {
        detail = text.trim()
      }
    }
    throw new Error(detail)
  }

  if (!response.body) {
    throw new Error('当前环境不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')

    let boundaryIndex = buffer.indexOf('\n\n')
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex).trim()
      buffer = buffer.slice(boundaryIndex + 2)

      if (rawEvent) {
        const event = parseIntelAiStreamEvent(rawEvent)
        if (event) {
          onEvent(event)
          if (event.type === 'error') {
            throw new Error(event.detail)
          }
          if (event.type === 'done') {
            completed = true
          }
        }
      }

      boundaryIndex = buffer.indexOf('\n\n')
    }
  }

  buffer += decoder.decode().replace(/\r/g, '')
  const rawEvent = buffer.trim()
  if (rawEvent) {
    const event = parseIntelAiStreamEvent(rawEvent)
    if (event) {
      onEvent(event)
      if (event.type === 'error') {
        throw new Error(event.detail)
      }
      if (event.type === 'done') {
        completed = true
      }
    }
  }

  if (!completed) {
    throw new Error('AI 流式响应中断')
  }
}

function renderContent(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  return lines.map((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('#') || (trimmed.startsWith('【') && trimmed.endsWith('】'))) {
      const text = trimmed.replace(/^#+\s+/, '').replace(/[【】]/g, '')
      return (
        <h4 key={i} className="mt-3 mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-blue-400 flex items-center gap-2">
          <span className="w-3 h-px bg-blue-500/60" />
          {text}
        </h4>
      )
    }

    if (/^([-*•]\s+|\d+[.)]\s+)/.test(trimmed)) {
      const text = trimmed.replace(/^([-*•]\s+|\d+[.)]\s+)/, '')
      return (
        <div key={i} className="flex gap-2 py-0.5 text-[12px] leading-5 text-[#bbb]">
          <span className="text-[#555] font-[var(--font-mono)] shrink-0">—</span>
          <span>{processBold(text)}</span>
        </div>
      )
    }

    return (
      <p key={i} className="mb-1.5 text-[12px] leading-[1.7] text-[#999] last:mb-0">
        {processBold(trimmed)}
      </p>
    )
  })
}

function processBold(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-black text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}

function signalTone(signal: string) {
  if (signal === 'BULLISH') return 'text-[var(--color-long)] border-[var(--color-long)]/40 bg-[var(--color-long)]/8'
  if (signal === 'BEARISH') return 'text-[var(--color-short)] border-[var(--color-short)]/40 bg-[var(--color-short)]/8'
  return 'text-amber-400 border-amber-400/30 bg-amber-400/8'
}

export function IntelAiDialog() {
  const navigate = useNavigate()
  const item = useIntelAiStore((state) => state.item)
  const open = useIntelAiStore((state) => state.open)
  const toggle = useIntelAiStore((state) => state.toggle)
  const close = useIntelAiStore((state) => state.close)
  const [sessions, setSessions] = useState<IntelAiSessions>({})
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<{ model: string; latency_ms: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sessionKey = item?.id || GLOBAL_SESSION_KEY
  const quickPrompts = item ? ITEM_QUICK_PROMPTS : GLOBAL_QUICK_PROMPTS

  const messages = useMemo(() => {
    return sessions[sessionKey] || []
  }, [sessionKey, sessions])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [close, open])

  useEffect(() => {
    if (!bodyRef.current) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, loading, open])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
  }, [sessionKey])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const askAi = async (question: string, silent = false) => {
    if (!question.trim() || loading) return
    const trimmedQuestion = question.trim()
    const existing = sessions[sessionKey] || []
    const nextMessages = silent
      ? [...existing, { role: 'assistant' as const, content: '' }]
      : [...existing, { role: 'user' as const, content: trimmedQuestion }, { role: 'assistant' as const, content: '' }]

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    startTransition(() => {
      setSessions((prev) => ({ ...prev, [sessionKey]: nextMessages }))
    })

    setLoading(true)
    setError('')
    setMeta(null)

    try {
      await streamIntelAiReply(
        item ? `/intel/${item.id}/chat/stream` : '/intel/chat/stream',
        {
          question: trimmedQuestion,
          history: existing,
        },
        controller.signal,
        (event) => {
          if (event.type === 'delta') {
            startTransition(() => {
              setSessions((prev) => {
                const session = prev[sessionKey]
                if (!session?.length) return prev

                const nextSession = [...session]
                const lastMessage = nextSession[nextSession.length - 1]
                if (!lastMessage || lastMessage.role !== 'assistant') return prev

                nextSession[nextSession.length - 1] = {
                  ...lastMessage,
                  content: `${lastMessage.content}${event.content}`,
                }
                return { ...prev, [sessionKey]: nextSession }
              })
            })
            return
          }

          if (event.type === 'done') {
            setMeta({ model: event.model, latency_ms: event.latency_ms })
            startTransition(() => {
              setSessions((prev) => {
                const session = prev[sessionKey]
                if (!session?.length) return prev

                const nextSession = [...session]
                const lastMessage = nextSession[nextSession.length - 1]
                if (!lastMessage || lastMessage.role !== 'assistant') return prev

                nextSession[nextSession.length - 1] = {
                  ...lastMessage,
                  content: event.reply || lastMessage.content,
                }
                return { ...prev, [sessionKey]: nextSession }
              })
            })
          }
        },
      )
    } catch (err: any) {
      if (err?.name === 'AbortError') return

      startTransition(() => {
        setSessions((prev) => {
          const session = prev[sessionKey]
          if (!session?.length) return prev

          const nextSession = [...session]
          const lastMessage = nextSession[nextSession.length - 1]
          if (lastMessage?.role === 'assistant' && !lastMessage.content.trim()) {
            nextSession.pop()
            return { ...prev, [sessionKey]: nextSession }
          }
          return prev
        })
      })

      setError(err.response?.data?.detail || err.message || 'AI 分析失败')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !item) return
    setInput('')
    setError('')
    setMeta(null)
    if ((sessions[item.id] || []).length === 0) {
      void askAi(INITIAL_ANALYSIS_PROMPT, true)
    }
  }, [item, open])

  return (
    <>
      {/* 触发按钮 */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[92] flex items-center">
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? '隐藏全局 AI 侧栏' : '展开全局 AI 侧栏'}
          className={`pointer-events-auto group relative flex h-[74px] w-[74px] items-center justify-center overflow-hidden rounded-[26px] border border-[#26415f] bg-[radial-gradient(circle_at_30%_25%,rgba(49,106,186,0.92),rgba(10,20,36,0.96)_42%,rgba(4,8,14,0.98)_72%)] text-[#d7e9ff] shadow-[0_22px_68px_rgba(0,0,0,0.52)] transition-all duration-300 ${
            open ? 'translate-y-[-4px] shadow-[0_28px_82px_rgba(0,0,0,0.62)]' : 'hover:-translate-y-1 hover:shadow-[0_28px_82px_rgba(0,0,0,0.62)]'
          }`}
          title={open ? '隐藏全局 AI 侧栏' : '展开全局 AI 侧栏'}
        >
          <span className="absolute inset-[7px] rounded-[20px] border border-white/10" />
          <span className="absolute inset-[15px] rounded-[18px] border border-cyan-300/20 opacity-80" />
          <span className="absolute left-3 top-3 h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.95)] animate-pulse" />
          <span className="absolute bottom-4 right-3 h-1.5 w-1.5 rounded-full bg-blue-200 shadow-[0_0_14px_rgba(191,219,254,0.9)]" />
          <span className="absolute left-[14px] top-[18px] h-[42px] w-[42px] rounded-full border border-blue-200/18" />
          <span className={`absolute left-[12px] top-[12px] h-[48px] w-[48px] rounded-full border border-cyan-300/12 transition-transform duration-500 ${open ? 'scale-95' : 'scale-100 group-hover:scale-110'}`} />
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(148,216,255,0.28),rgba(10,16,27,0.04)_62%,transparent_72%)]">
            <svg className={`h-6 w-6 transition-transform duration-500 ${open ? 'rotate-90 scale-105' : 'group-hover:rotate-12'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M12 3.5 13.7 8l4.8 1.6-4.8 1.6L12 15.7l-1.7-4.5L5.5 9.6 10.3 8 12 3.5Z" />
              <path d="M18.4 15.3 19.2 17.4l2.2.8-2.2.8-.8 2.1-.8-2.1-2.2-.8 2.2-.8.8-2.1Z" />
              <path d="M7.5 15.5c1.5 1.3 2.8 2 4.5 2 1.8 0 3.3-.8 4.5-2" opacity="0.75" />
            </svg>
          </div>
        </button>
      </div>

      {/* 侧边栏面板 */}
      <div
        className={`pointer-events-none fixed inset-y-0 right-0 z-[91] flex justify-end transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="pointer-events-auto flex h-full w-[min(440px,calc(100vw-1.5rem))] flex-col border-l border-[#222] bg-[#050505]">

          {/* 顶部标题栏 */}
          <div className="h-12 shrink-0 border-b border-[#222] bg-[#0A0A0A] flex items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-blue-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white font-[var(--font-mono)]">AI 情报助手</span>
              {meta && (
                <span className="text-[9px] font-bold font-[var(--font-mono)] text-[#555]">
                  {meta.latency_ms}ms
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              className="w-7 h-7 flex items-center justify-center border border-[#333] text-[#666] hover:border-[#555] hover:text-white transition-colors"
              title="收起"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {/* 情报上下文卡片 */}
          {item ? (
            <div className="shrink-0 border-b border-[#222] px-4 py-3 bg-[#0A0A0A]">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border ${signalTone(item.signal)}`}>{item.signal}</span>
                <span className="text-[9px] font-bold font-[var(--font-mono)] text-[#555] uppercase">{item.source_name}</span>
                {item.symbols.map((symbol) => (
                  <span key={symbol} className="text-[9px] font-black font-[var(--font-mono)] text-blue-400 bg-blue-400/8 border border-blue-400/20 px-1">
                    {symbol.replace('USDT', '')}
                  </span>
                ))}
              </div>
              <p className="line-clamp-2 text-[12px] font-bold text-[#ccc] leading-snug">{item.title}</p>
            </div>
          ) : (
            <div className="shrink-0 border-b border-[#222] px-4 py-3 bg-[#0A0A0A]">
              <p className="text-[11px] font-[var(--font-mono)] text-[#555] leading-relaxed">
                // 无绑定情报 — 全局市场助手模式
              </p>
            </div>
          )}

          {/* 消息区域 */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
            {!item && messages.length === 0 ? (
              <div className="flex flex-col gap-4 pt-4">
                <div className="border border-[#222] bg-[#0A0A0A] p-4">
                  <div className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400 font-[var(--font-mono)] mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 animate-pulse" />
                    全局助手已就绪
                  </div>
                  <p className="text-[12px] text-[#777] leading-relaxed">
                    可直接提问市场、风险或交易观察。如需围绕特定情报深入讨论，前往情报页点击 <code className="text-blue-400 font-[var(--font-mono)]">AI</code> 按钮绑定上下文。
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/intel')}
                    className="mt-3 text-[9px] font-black uppercase tracking-[0.18em] font-[var(--font-mono)] text-[#666] hover:text-white border border-[#333] px-3 py-1.5 hover:border-[#555] transition-colors"
                  >
                    前往情报页 →
                  </button>
                </div>
              </div>
            ) : messages.length === 0 && loading ? (
              <div className="flex justify-start">
                <div className="relative max-w-[88%] overflow-hidden rounded-[22px] border border-blue-500/18 bg-[linear-gradient(160deg,rgba(14,24,40,0.96),rgba(7,11,18,0.98))] px-4 py-3 shadow-[0_18px_46px_rgba(0,0,0,0.32)]">
                  <span className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.7),transparent)]" />
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex h-6 items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 text-[9px] font-black uppercase tracking-[0.2em] text-blue-300 font-[var(--font-mono)]">
                      INTEL STREAM
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[#7d92a8]">
                    <span className="inline-flex gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-blue-400/80 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="h-1 w-1 rounded-full bg-cyan-300/80 animate-bounce" style={{ animationDelay: '140ms' }} />
                      <span className="h-1 w-1 rounded-full bg-blue-200/80 animate-bounce" style={{ animationDelay: '280ms' }} />
                    </span>
                    正在推演市场影响...
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`flex ${message.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`relative max-w-[88%] ${message.role === 'assistant' ? '' : 'w-fit min-w-[58%]'}`}>
                      <div className={`mb-1.5 flex items-center gap-2 ${message.role === 'assistant' ? '' : 'justify-end'}`}>
                        {message.role === 'assistant' ? (
                          <>
                            <span className="inline-flex h-6 items-center rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 text-[9px] font-black uppercase tracking-[0.2em] text-blue-300 font-[var(--font-mono)]">
                              INTEL
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#4f6378] font-[var(--font-mono)]">
                              Analysis
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#5f5f5f] font-[var(--font-mono)]">
                              Manual Input
                            </span>
                            <span className="inline-flex h-6 items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 text-[9px] font-black uppercase tracking-[0.2em] text-white font-[var(--font-mono)]">
                              YOU
                            </span>
                          </>
                        )}
                      </div>

                      <div
                        className={`relative overflow-hidden rounded-[22px] border px-4 py-3 shadow-[0_18px_46px_rgba(0,0,0,0.28)] ${
                          message.role === 'assistant'
                            ? 'border-blue-500/18 bg-[linear-gradient(160deg,rgba(14,24,40,0.96),rgba(7,11,18,0.98))]'
                            : 'border-[#3b3b3b] bg-[linear-gradient(160deg,rgba(26,26,26,0.98),rgba(10,10,10,0.98))]'
                        }`}
                      >
                        <span
                          className={`absolute inset-x-0 top-0 h-px ${
                            message.role === 'assistant'
                              ? 'bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.7),transparent)]'
                              : 'bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.34),transparent)]'
                          }`}
                        />
                        <span
                          className={`pointer-events-none absolute inset-y-3 ${message.role === 'assistant' ? 'left-0 w-px bg-[linear-gradient(180deg,transparent,rgba(59,130,246,0.72),transparent)]' : 'right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.18),transparent)]'}`}
                        />

                        {message.role === 'assistant' ? (
                          <div className="flow-root">{renderContent(message.content)}</div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#767676] font-[var(--font-mono)]">
                              &gt; query
                            </div>
                            <p className="text-[12px] font-semibold text-white leading-relaxed whitespace-pre-wrap tracking-[0.01em]">
                              {message.content}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {loading && messages.length > 0 && (
                  <div className="flex justify-start">
                    <div className="relative max-w-[88%] overflow-hidden rounded-[22px] border border-blue-500/14 bg-[linear-gradient(160deg,rgba(13,21,36,0.9),rgba(7,11,18,0.96))] px-4 py-3 shadow-[0_16px_34px_rgba(0,0,0,0.2)]">
                      <span className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(96,165,250,0.52),transparent)]" />
                      <div className="flex items-center gap-2 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[#6f87a0]">
                        <span className="inline-flex h-5 items-center rounded-full border border-blue-400/15 bg-blue-400/8 px-2 text-[8px] font-black tracking-[0.2em] text-blue-300">
                          LIVE
                        </span>
                        <span className="inline-flex gap-0.5">
                          <span className="h-1 w-1 rounded-full bg-blue-400/80 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="h-1 w-1 rounded-full bg-cyan-300/80 animate-bounce" style={{ animationDelay: '140ms' }} />
                          <span className="h-1 w-1 rounded-full bg-blue-200/80 animate-bounce" style={{ animationDelay: '280ms' }} />
                        </span>
                        正在继续分析
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 底部输入区 */}
          <div className="shrink-0 border-t border-[#222] bg-[#0A0A0A] px-4 py-3">
            {/* 快捷提示 */}
            <div className="flex flex-wrap gap-1 mb-3">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={loading}
                  onClick={() => void askAi(prompt)}
                  className="border border-[#2a2a2a] bg-[#111] px-2 py-1 text-[9px] font-bold text-[#777] hover:border-[#444] hover:text-white transition-colors disabled:opacity-30 font-[var(--font-mono)]"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* 输入框 */}
            <div className="flex gap-0 border border-[#333] focus-within:border-blue-500/60 transition-colors bg-[#111]">
              <span className="flex items-start pt-3 pl-3 text-[12px] font-black font-[var(--font-mono)] text-[#444] select-none shrink-0">&gt;</span>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    const nextQuestion = input
                    setInput('')
                    void askAi(nextQuestion)
                  }
                }}
                rows={2}
                placeholder={item ? '继续追问这条情报...' : '提问市场问题...'}
                className="flex-1 resize-none bg-transparent border-0 px-2 py-3 text-[12px] leading-5 text-white outline-none placeholder:text-[#3a3a3a] font-[var(--font-mono)]"
              />
              <button
                type="button"
                disabled={loading || !input.trim()}
                onClick={() => {
                  const nextQuestion = input
                  setInput('')
                  void askAi(nextQuestion)
                }}
                className="self-end mb-1.5 mr-1.5 px-3 py-1.5 bg-white text-black text-[9px] font-black uppercase tracking-[0.2em] hover:bg-gray-200 disabled:bg-[#222] disabled:text-[#555] transition-colors"
              >
                发送
              </button>
            </div>

            {error && (
              <div className="mt-2 border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/8 px-3 py-2 text-[10px] font-[var(--font-mono)] text-[var(--color-danger)]">
                [ERR] {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
