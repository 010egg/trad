import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import api from '@/lib/api'
import { useIntelAiStore } from '@/stores/useIntelAiStore'

type IntelAiMessage = {
  role: 'user' | 'assistant'
  content: string
}

type IntelAiSessions = Record<string, IntelAiMessage[]>

type IntelAiResponse = {
  reply: string
  model: string
  latency_ms: number
}

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

function renderContent(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  return lines.map((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('#') || (trimmed.startsWith('【') && trimmed.endsWith('】'))) {
      const text = trimmed.replace(/^#+\s+/, '').replace(/[【】]/g, '')
      return (
        <h4 key={i} className="mt-2 mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">
          <span className="h-2.5 w-1 rounded-full bg-blue-500/50" />
          {text}
        </h4>
      )
    }

    if (/^([-*•]\s+|\d+[.)]\s+)/.test(trimmed)) {
      const text = trimmed.replace(/^([-*•]\s+|\d+[.)]\s+)/, '')
      return (
        <div key={i} className="flex gap-2 py-0.5 text-[13px] leading-5 text-[#c8d0db]">
          <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400/80" />
          <span>{processBold(text)}</span>
        </div>
      )
    }

    return (
      <p key={i} className="mb-1 text-[13px] leading-6 text-[#aeb7c4] last:mb-0">
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
  if (signal === 'BULLISH') return 'text-[var(--color-long)] border-[var(--color-long)]/30 bg-[var(--color-long)]/10'
  if (signal === 'BEARISH') return 'text-[var(--color-short)] border-[var(--color-short)]/30 bg-[var(--color-short)]/10'
  return 'text-amber-300 border-amber-300/20 bg-amber-300/10'
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

  const askAi = async (question: string, silent = false) => {
    if (!question.trim() || loading) return
    const existing = sessions[sessionKey] || []
    const nextMessages = silent ? existing : [...existing, { role: 'user' as const, content: question.trim() }]

    if (!silent) {
      setSessions((prev) => ({ ...prev, [sessionKey]: nextMessages }))
    }

    setLoading(true)
    setError('')

    try {
      const data: IntelAiResponse = await api.post(item ? `/intel/${item.id}/chat` : '/intel/chat', {
        question: question.trim(),
        history: existing,
      })

      setMeta({ model: data.model, latency_ms: data.latency_ms })
      setSessions((prev) => ({
        ...prev,
        [sessionKey]: [...nextMessages, { role: 'assistant', content: data.reply }],
      }))
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'AI 分析失败')
    } finally {
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

      <div
        className={`pointer-events-none fixed inset-y-0 right-0 z-[91] flex justify-end px-3 pb-3 pt-[60px] transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-[calc(100%+24px)]'
        }`}
      >
        <div className="pointer-events-auto flex h-full w-[min(460px,calc(100vw-1.5rem))] items-stretch">
          <aside className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-[#243247] bg-[linear-gradient(180deg,#0b0f15_0%,#06080c_100%)] shadow-[0_20px_80px_rgba(0,0,0,0.72)]">
            <div className="shrink-0 border-b border-[#1b2533] bg-[linear-gradient(180deg,#101826_0%,#0a111b_100%)] px-4 py-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-sm bg-blue-500 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-300">全局 AI 情报舱</span>
                  </div>
                  <div className="text-[10px] font-bold font-[var(--font-mono)] text-[#617086]">
                    跨页面保留上下文，随时继续追问当前情报
                    {meta ? ` · ${meta.model} · ${meta.latency_ms}ms` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={close}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#263549] bg-[#0b1320] text-[#88a6c7] transition-colors hover:border-blue-400/40 hover:text-white"
                  title="收起 AI 情报舱"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>

              {item ? (
                <div className="rounded-2xl border border-[#1f2b3d] bg-[#09111c]/80 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase border ${signalTone(item.signal)}`}>{item.signal}</span>
                    <span className="text-[9px] font-bold font-[var(--font-mono)] uppercase tracking-[0.18em] text-[#70809a]">{item.source_name}</span>
                    {item.symbols.map((symbol) => (
                      <span key={symbol} className="text-[10px] font-black font-[var(--font-mono)] text-blue-300">
                        #{symbol.replace('USDT', '')}
                      </span>
                    ))}
                  </div>
                  <h3 className="line-clamp-2 text-sm font-black leading-tight text-white">{item.title}</h3>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#243247] bg-[#09111c]/35 px-3 py-4 text-[12px] leading-6 text-[#7c8798]">
                  当前没有绑定具体情报，你可以直接把它当成全局市场助手使用；如果之后在情报页点某条消息的 `AI`，这里会自动切到那条情报的上下文。
                </div>
              )}
            </div>

            <div ref={bodyRef} className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_28%),linear-gradient(180deg,#06090d_0%,#040608_100%)] px-4 py-4">
              {!item && messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="max-w-[320px] rounded-[28px] border border-[#1f2b3d] bg-[#0a1017]/90 p-5 text-left">
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-blue-300">
                      <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
                      全局 AI 助手已待命
                    </div>
                    <div className="text-[13px] leading-6 text-[#93a1b3]">
                      现在就可以直接提问市场、风险或交易观察相关问题。如果你想围绕某条资讯深入讨论，再去情报页点对应消息的 `AI`。
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/intel')}
                      className="mt-4 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-200 transition-colors hover:bg-blue-500/16"
                    >
                      前往情报页绑定消息
                      <span aria-hidden="true">-&gt;</span>
                    </button>
                  </div>
                </div>
              ) : messages.length === 0 && loading ? (
                <div className="rounded-xl border border-[#1f2b3d] bg-[#0b1016] px-4 py-4 text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[#7f8da0] animate-pulse">
                  {item ? '正在初始化 AI 市场分析...' : '正在连接全局 AI 助手...'}
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`${message.role === 'assistant' ? '' : 'pl-6'}`}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <div
                          className={`flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-black ${
                            message.role === 'assistant'
                              ? 'bg-blue-500 text-white'
                              : 'bg-[#223046] text-[#dce7f8]'
                          }`}
                        >
                          {message.role === 'assistant' ? 'AI' : 'ME'}
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#536273]">
                          {message.role === 'assistant' ? 'Intelligence' : 'Prompt'}
                        </span>
                      </div>

                      <div
                        className={`rounded-2xl border px-4 py-3 ${
                          message.role === 'assistant'
                            ? 'border-[#1f2b3d] bg-[#0b1016]'
                            : 'border-[#27405f] bg-[#0c1826]'
                        }`}
                      >
                        {message.role === 'assistant' ? (
                          <div className="flow-root">{renderContent(message.content)}</div>
                        ) : (
                          <div className="whitespace-pre-wrap text-[13px] font-bold leading-6 text-[#dce7f8]">
                            {message.content}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {loading && messages.length > 0 && (
                    <div className="rounded-2xl border border-[#1f2b3d] bg-[#0b1016] px-4 py-4">
                      <div className="flex gap-1">
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500/60 animate-bounce" style={{ animationDelay: '140ms' }} />
                        <div className="h-1.5 w-1.5 rounded-full bg-blue-500/60 animate-bounce" style={{ animationDelay: '280ms' }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-[#1b2533] bg-[#08101a] px-4 py-4">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={loading}
                    onClick={() => void askAi(prompt)}
                    className="rounded-full border border-[#243247] bg-[#0d1420] px-2.5 py-1 text-[10px] font-black text-[#90a3bf] transition-colors hover:border-blue-500/40 hover:text-blue-200 disabled:opacity-35"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="relative">
                <textarea
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
                  rows={3}
                  placeholder={item ? '继续追问这条情报...' : '直接问市场问题，或先去情报页绑定一条消息...'}
                  className="w-full resize-none rounded-2xl border border-[#243247] bg-[#0d1420] px-4 py-3 pr-24 text-[13px] leading-6 text-white outline-none transition-colors placeholder:text-[#4f5f73] focus:border-blue-500 disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={loading || !input.trim()}
                  onClick={() => {
                    const nextQuestion = input
                    setInput('')
                    void askAi(nextQuestion)
                  }}
                  className="absolute bottom-3 right-3 rounded-xl bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-black transition-colors hover:bg-gray-200 disabled:bg-[#243247] disabled:text-[#56657a]"
                >
                  发送
                </button>
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-[var(--font-mono)] text-red-200">
                  [错误] {error}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
