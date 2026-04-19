import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MainLayout } from '@/layouts/MainLayout'
import { triggerIntelCardAiAction } from '@/features/intel/intelCardAiAction'
import { useIntelStore, type IntelFilters, type IntelItem } from '@/stores/useIntelStore'
import { useIntelAiStore } from '@/stores/useIntelAiStore'

const CATEGORY_LABELS: Record<string, string> = {
  macro: '宏观经济',
  onchain: '链上数据',
  exchange: '交易所',
  regulation: '政策监管',
  project: '项目进展',
}

const SIGNAL_LABELS: Record<string, string> = {
  ALL: '全部方向',
  BULLISH: '偏多',
  BEARISH: '偏空',
  NEUTRAL: '观察',
}

const CONFIDENCE_OPTIONS = [
  { value: 0, label: '全部' },
  { value: 0.6, label: '>60%' },
  { value: 0.8, label: '>80%' },
]

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatFullDate(value: string | null) {
  if (!value) return '--'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value))
}

function confirmationScore(count: number): number {
  if (count <= 1) return 0.30
  if (count === 2) return 0.60
  if (count === 3) return 0.85
  return 1.0
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value || 0))
}

function formatScore(value: number): string {
  return `${Math.round(clampScore(value) * 100)}%`
}

function isSameHeadline(primary: string, original: string) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ')
  return normalize(primary) === normalize(original)
}

function formatElapsed(from: string | null, to: string | null) {
  if (!from || !to) return '--'
  const diffMs = Math.max(new Date(to).getTime() - new Date(from).getTime(), 0)
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return '<1m'
  if (diffMin < 60) return `${diffMin}m`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`
  const diffDay = Math.round(diffHour / 24)
  return `${diffDay}d`
}

function ConfidenceTooltip({ item }: { item: IntelItem }) {
  const rows = [
    { label: '来源可信度', value: item.source_score ?? 0.5, weight: '30%', extra: item.source_name },
    { label: '时效性', value: item.freshness_score ?? 0.5, weight: '20%', extra: `录入时差 ${formatElapsed(item.published_at, item.ingested_at)}` },
    { label: '多源印证', value: confirmationScore(item.confirmation_count ?? 1), weight: '20%', extra: `${item.confirmation_count ?? 1} 源` },
    { label: '语义判断', value: item.semantic_score ?? 0.5, weight: '30%' },
  ]

  return (
    <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded border border-white/12 bg-[#0d1117]/72 p-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)] opacity-0 translate-y-1 transition-all duration-150 group-hover/confidence:translate-y-0 group-hover/confidence:opacity-100 group-focus-within/confidence:translate-y-0 group-focus-within/confidence:opacity-100">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[9px] font-black uppercase tracking-widest text-[#8b949e]">置信度构成</div>
        <div className="text-[8px] font-bold font-[var(--font-mono)] text-[#666]">30 / 20 / 20 / 30</div>
      </div>
      {rows.map(row => (
        <div key={row.label} className="mb-2 last:mb-0">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div className="text-[9px] text-[#8b949e]">{row.label}</div>
            <div className="min-w-0 truncate text-[8px] font-bold font-[var(--font-mono)] text-[#666]">{row.weight}{row.extra ? ` · ${row.extra}` : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#21262d]">
              <div className="h-full rounded-full bg-blue-500" style={{ width: formatScore(row.value) }} />
            </div>
            <div className="w-10 shrink-0 text-right text-[9px] font-black font-[var(--font-mono)] text-white">{formatScore(row.value)}</div>
          </div>
        </div>
      ))}
      <div className="mt-2 pt-1.5 border-t border-[#21262d] flex justify-between items-center">
        <span className="text-[9px] text-[#8b949e]">综合置信度</span>
        <span className="text-[10px] font-black font-[var(--font-mono)] text-white">{formatScore(item.confidence)}</span>
      </div>
    </div>
  )
}

function ConfidenceValue({
  item,
  className,
  showLabel = false,
}: {
  item: IntelItem
  className: string
  showLabel?: boolean
}) {
  return (
    <span className="group/confidence relative inline-flex items-center">
      <span
        tabIndex={0}
        title="悬浮查看置信度构成"
        className={`${className} cursor-help underline decoration-dotted underline-offset-2 outline-none transition-colors focus-visible:text-white`}
      >
        {showLabel ? `置信度: ${formatScore(item.confidence)}` : formatScore(item.confidence)}
      </span>
      <ConfidenceTooltip item={item} />
    </span>
  )
}

export function IntelPage() {
  const navigate = useNavigate()
  const feed = useIntelStore((state) => state.feed)
  const selectedId = useIntelStore((state) => state.selectedId)
  const filters = useIntelStore((state) => state.filters)
  const filterOptions = useIntelStore((state) => state.filterOptions)
  const nextCursor = useIntelStore((state) => state.nextCursor)
  const stale = useIntelStore((state) => state.stale)
  const lastRefreshedAt = useIntelStore((state) => state.lastRefreshedAt)
  const loading = useIntelStore((state) => state.loading)
  const loadingMore = useIntelStore((state) => state.loadingMore)
  const refreshing = useIntelStore((state) => state.refreshing)
  const error = useIntelStore((state) => state.error)
  const selectItem = useIntelStore((state) => state.selectItem)
  const fetchFilters = useIntelStore((state) => state.fetchFilters)
  const fetchFeed = useIntelStore((state) => state.fetchFeed)
  const refreshFeed = useIntelStore((state) => state.refreshFeed)
  const refreshItem = useIntelStore((state) => state.refreshItem)
  const globalAiItem = useIntelAiStore((state) => state.item)
  const openAiWithItem = useIntelAiStore((state) => state.openWithItem)
  const setGlobalAiItem = useIntelAiStore((state) => state.setItem)
  const [queryInput, setQueryInput] = useState(filters.q)
  const [searchOpen, setSearchOpen] = useState(false)
  const [refreshingItemId, setRefreshingItemId] = useState<string | null>(null)
  const searchRegionRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const deferredQuery = useDeferredValue(queryInput.trim())

  useEffect(() => {
    void Promise.allSettled([fetchFilters(), fetchFeed({ reset: true })])
  }, [fetchFeed, fetchFilters])

  useEffect(() => {
    if (deferredQuery === filters.q) return
    void fetchFeed({ reset: true, filters: { q: deferredQuery } })
  }, [deferredQuery, fetchFeed, filters.q])

  useEffect(() => {
    if (!globalAiItem) return
    const nextItem = feed.find((item) => item.id === globalAiItem.id)
    if (nextItem && nextItem !== globalAiItem) {
      setGlobalAiItem(nextItem)
    }
  }, [feed, globalAiItem, setGlobalAiItem])

  useEffect(() => {
    if (!searchOpen) return
    searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!searchRegionRef.current?.contains(event.target as Node)) {
        setSearchOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [searchOpen])

  const selectedItem = feed.find((item) => item.id === selectedId) || feed[0] || null

  const handleFilterChange = (patch: Partial<IntelFilters>) => {
    void fetchFeed({ reset: true, filters: patch })
  }

  const openAiDialog = (item: IntelItem) => {
    selectItem(item.id)
    openAiWithItem(item)
  }

  const handleRefreshItem = async (item: IntelItem) => {
    await triggerIntelCardAiAction(item, {
      openAiDialog,
      refreshItem,
      selectItem,
      setRefreshingItemId,
    })
  }

  const getSignalColor = (signal: string) => {
    if (signal === 'BULLISH') return 'text-[var(--color-long)]'
    if (signal === 'BEARISH') return 'text-[var(--color-short)]'
    return 'text-amber-500'
  }

  const getSignalBg = (signal: string) => {
    if (signal === 'BULLISH') return 'bg-[var(--color-long)] text-black'
    if (signal === 'BEARISH') return 'bg-[var(--color-short)] text-white'
    return 'bg-amber-500 text-black'
  }

  return (
    <MainLayout>
      <div className="relative h-full flex flex-col bg-[#050505] text-[var(--color-text-primary)] font-sans overflow-hidden selection:bg-blue-500/30">
        
        {/* 顶部控制栏 - 极简终端风格 */}
        <header className="h-12 border-b border-[#222] bg-[#0A0A0A] shrink-0 flex items-center justify-between px-4 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-6 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">市场情报终端</span>
            </div>
            
            <div className="h-4 w-px bg-[#333]" />
            
            {/* 实时状态监控 */}
            <div className="flex items-center gap-4 text-[10px] font-bold font-[var(--font-mono)] text-[#666]">
              <div className="flex gap-1.5"><span>同步时间</span> <span className="text-white">{formatFullDate(lastRefreshedAt)}</span></div>
              <div className="flex gap-1.5"><span>运行状态</span> <span className={stale ? 'text-amber-500' : 'text-blue-400'}>{stale ? '更新中' : '实时'}</span></div>
              <div className="flex gap-1.5"><span>情报总数</span> <span className="text-white">{feed.length}</span></div>
            </div>
          </div>

          {/* 过滤器 */}
          <div className="flex items-center gap-2 shrink-0 ml-6">
            <select
              value={filters.symbol}
              onChange={(e) => handleFilterChange({ symbol: e.target.value })}
              className="py-1 px-2 bg-[#111] border border-[#333] text-[10px] font-bold font-[var(--font-mono)] text-white cursor-pointer hover:border-[#555] outline-none"
            >
              <option value="ALL">全部交易对</option>
              {filterOptions.symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              value={filters.signal}
              onChange={(e) => handleFilterChange({ signal: e.target.value })}
              className="py-1 px-2 bg-[#111] border border-[#333] text-[10px] font-bold font-[var(--font-mono)] text-white cursor-pointer hover:border-[#555] outline-none"
            >
              <option value="ALL">全部信号方向</option>
              {filterOptions.signals.map((s) => <option key={s} value={s}>{SIGNAL_LABELS[s] || s}</option>)}
            </select>

            <div className="flex flex-col items-end gap-0.5">
              <button
                onClick={() => void refreshFeed()}
                disabled={refreshing}
                title="抓取最新资讯并调用已配置的大模型重新摘要与打分"
                className="py-1 px-3 bg-[#111] border border-[#333] text-[10px] font-black text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
              >
                {refreshing ? 'AI 分析中...' : '调用 AI 刷新'}
              </button>
              <div className="text-[9px] font-bold font-[var(--font-mono)] text-[#555]">
                抓取新情报并重新摘要打分
              </div>
            </div>
          </div>
        </header>

        {/* 主内容区域 */}
        <main className="flex-1 flex overflow-hidden">
          
          {/* 左侧栏：高密度情报流 */}
          <aside className="w-[380px] xl:w-[420px] flex flex-col border-r border-[#222] bg-[#050505] shrink-0">
            <div className="relative flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#222] bg-[#0A0A0A] shrink-0">
              <div ref={searchRegionRef} className="relative flex items-center gap-2 min-w-0">
                <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-[#666]">实时情报流</span>
                <button
                  type="button"
                  onClick={() => setSearchOpen((open) => !open)}
                  aria-label={searchOpen ? '收起搜索' : '打开搜索'}
                  className={`relative flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full border transition-all ${
                    searchOpen || queryInput
                      ? 'border-blue-400/40 bg-blue-500/12 text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.12),0_6px_18px_rgba(15,23,42,0.28)]'
                      : 'border-white/8 bg-white/[0.03] text-[#61748a] hover:border-white/14 hover:text-[#9fb4cb]'
                  }`}
                  title="搜索情报"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {queryInput && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-300" />
                  )}
                </button>

                {searchOpen && (
                  <div className="absolute left-0 top-full z-20 mt-2 w-[220px] rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(11,16,24,0.96),rgba(6,9,14,0.94))] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                    <div className="group/search relative">
                      <svg className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#58708c] transition-colors group-focus-within/search:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        ref={searchInputRef}
                        aria-label="搜索情报"
                        value={queryInput}
                        onChange={(e) => setQueryInput(e.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setSearchOpen(false)
                          }
                        }}
                        placeholder="搜索标题、摘要、关键词"
                        className="h-9 w-full rounded-xl border border-white/8 bg-white/[0.04] pl-10 pr-16 text-[11px] font-bold font-[var(--font-mono)] text-white outline-none transition-all placeholder:text-[#4d5a69] focus:border-blue-400/40 focus:bg-[#0d1520] focus:shadow-[0_0_0_1px_rgba(96,165,250,0.14)]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setQueryInput('')
                          setSearchOpen(false)
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-white/8 px-1.5 py-0.5 text-[9px] font-black font-[var(--font-mono)] text-[#7e8b99] transition-colors hover:border-white/14 hover:text-white"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {/* 置信度快捷筛选 */}
              <div className="flex gap-1 shrink-0">
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleFilterChange({ min_confidence: opt.value })}
                    className={`px-1.5 py-0.5 text-[9px] font-bold font-[var(--font-mono)] border transition-colors ${
                      filters.min_confidence === opt.value 
                        ? 'border-[#ccc] text-white' 
                        : 'border-transparent text-[#666] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {loading && !feed.length ? (
                <div className="p-4 space-y-2">
                  {Array.from({length: 15}).map((_, i) => (
                    <div key={i} className="h-10 bg-[#111] animate-pulse border-l-2 border-transparent" />
                  ))}
                </div>
              ) : feed.length === 0 ? (
                <div className="p-8 text-center text-sm font-mono text-[#666]">
                  // 未检测到符合条件的情报
                </div>
              ) : (
                <div className="divide-y divide-[#1a1a1a]">
                  {feed.map((item) => {
                    const active = item.id === selectedId
                    const signalColor = getSignalColor(item.signal)
                    
                    return (
                      <div
                        key={item.id}
                        onClick={() => selectItem(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            selectItem(item.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`w-full text-left p-3 transition-colors flex gap-3 border-l-2 ${
                          active 
                            ? 'bg-[#111] border-blue-500' 
                            : 'border-transparent hover:bg-[#0A0A0A]'
                        }`}
                      >
                        <div className="w-14 shrink-0 text-right pt-0.5">
                          <div className="text-[10px] font-bold font-[var(--font-mono)] text-[#666]">{formatTime(item.published_at)}</div>
                          <div className={`mt-1 text-[9px] font-black font-[var(--font-mono)] ${signalColor}`}>{formatScore(item.confidence)}</div>
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 text-[9px] font-black tracking-wider uppercase">
                            <span className={signalColor}>{SIGNAL_LABELS[item.signal] || item.signal}</span>
                            <span className="text-[#444]">·</span>
                            <span className="text-white bg-white/10 px-1 rounded-sm">{CATEGORY_LABELS[item.category] || item.category}</span>
                            {item.symbols[0] && (
                              <span className="text-blue-400 bg-blue-400/10 px-1 rounded-sm">{item.symbols[0].replace('USDT','')}</span>
                            )}
                          </div>
                          <div className={`text-xs font-bold leading-snug line-clamp-2 ${active ? 'text-white' : 'text-[#aaa]'}`}>
                            {item.ai_title}
                          </div>
                          {!isSameHeadline(item.ai_title, item.title) && (
                            <div
                              title={item.title}
                              className={`mt-1 text-[10px] leading-snug line-clamp-2 ${active ? 'text-[#7d8590]' : 'text-[#666]'}`}
                            >
                              {item.title}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleRefreshItem(item)
                          }}
                          disabled={refreshingItemId === item.id}
                          className="shrink-0 self-start px-1.5 py-1 text-[9px] font-black font-[var(--font-mono)] text-blue-300 border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
                          title="对这条情报单独重新生成 AI 标题、摘要和打分"
                        >
                          {refreshingItemId === item.id ? '...' : 'AI'}
                        </button>
                      </div>
                    )
                  })}
                  
                  <button
                    onClick={() => void fetchFeed({ reset: false })}
                    disabled={!nextCursor || loadingMore}
                    className="w-full py-4 text-[10px] font-black uppercase font-[var(--font-mono)] text-[#666] hover:bg-[#111] hover:text-white transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? '正在获取数据...' : nextCursor ? '加载更多情报' : '已经到达流底部'}
                  </button>
                </div>
              )}
            </div>
          </aside>

          {/* 右侧栏：深度情报详情 */}
          <article className="flex-1 flex flex-col bg-[#050505] overflow-y-auto custom-scrollbar relative">
            {selectedItem ? (
              <div className="p-6 md:p-8 max-w-5xl mx-auto w-full">
                
                {/* 元数据页眉 */}
                <div className="flex items-center gap-3 mb-6 border-b border-[#222] pb-4">
                  <div className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest ${getSignalBg(selectedItem.signal)}`}>
                    {SIGNAL_LABELS[selectedItem.signal] || selectedItem.signal}
                  </div>
                  <ConfidenceValue
                    item={selectedItem}
                    showLabel
                    className="text-[12px] font-black font-[var(--font-mono)] text-white"
                  />
                  <div className="flex-1" />
                  <div className="text-[10px] font-bold font-[var(--font-mono)] text-[#666] uppercase text-right leading-relaxed">
                    发布: {formatFullDate(selectedItem.published_at)}<br />
                    来源: {selectedItem.source_name}
                  </div>
                  <button
                    type="button"
                    onClick={() => openAiDialog(selectedItem)}
                    className="px-3 py-2 border border-blue-500/30 bg-blue-500/10 text-[10px] font-black uppercase tracking-[0.18em] text-blue-300 hover:bg-blue-500/15 transition-colors"
                  >
                    深入讨论
                  </button>
                </div>

                {/* 标题 */}
                <div className="mb-8">
                  <h1 className="text-2xl md:text-3xl font-black text-white leading-tight tracking-tight">
                    {selectedItem.ai_title}
                  </h1>
                  {!isSameHeadline(selectedItem.ai_title, selectedItem.title) && (
                    <p className="mt-3 text-sm leading-relaxed text-[#7d8590] max-w-4xl">
                      原始标题：{selectedItem.title}
                    </p>
                  )}
                </div>

                {/* 分析网格布局 */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  
                  {/* 左侧：摘要与推理 */}
                  <div className="xl:col-span-2 space-y-6">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#666] mb-3 border-b border-[#222] pb-1">AI 深度摘要提炼</div>
                      <p className="text-[13px] leading-relaxed text-[#ccc] font-medium whitespace-pre-wrap">
                        {selectedItem.summary_ai}
                      </p>
                    </div>
                    
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#666] mb-3 border-b border-[#222] pb-1">决策推理逻辑</div>
                      <div className="text-[13px] leading-relaxed text-white font-[var(--font-mono)] bg-[#0A0A0A] p-4 border border-[#222] whitespace-pre-wrap break-words">
                        {selectedItem.reasoning}
                      </div>
                    </div>
                  </div>

                  {/* 右侧：执行联动 */}
                  <div className="space-y-4">
                    <div className="bg-[#0A0A0A] border border-[#222] p-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-4 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-sm animate-pulse" /> 相关可交易标的
                      </div>
                      
                      {selectedItem.symbols.length > 0 ? (
                        <div className="space-y-3">
                          {selectedItem.symbols.map(sym => (
                            <div key={sym} className="flex items-center justify-between">
                              <span className="text-sm font-black text-white tracking-tight">{sym}</span>
                              <button
                                onClick={() => navigate(`/?symbol=${sym}`)}
                                className="px-3 py-1 bg-white text-black text-[9px] font-black uppercase tracking-widest hover:bg-gray-300 transition-colors"
                              >
                                立即交易 &rarr;
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] font-[var(--font-mono)] text-[#666] leading-relaxed">
                          未匹配到具体交易对。<br/>建议将其作为宏观背景参考。
                        </div>
                      )}
                    </div>

                    <div className="bg-[#0A0A0A] border border-[#222] p-4">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[#666] mb-3">数据溯源</div>
                      <a 
                        href={selectedItem.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-[11px] font-[var(--font-mono)] text-blue-400 hover:text-blue-300 underline break-all"
                      >
                        [ 查看情报原始数据源 ]
                      </a>
                    </div>
                  </div>

                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center font-[var(--font-mono)] text-sm text-[#444]">
                // 请从左侧列表选择情报以查看详情
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="absolute bottom-4 right-4 max-w-sm bg-red-950/90 border border-red-500 text-red-200 p-3 text-[11px] font-[var(--font-mono)] font-bold shadow-2xl z-50">
                [系统错误] {error}
              </div>
            )}
          </article>
        </main>

      </div>
    </MainLayout>
  )
}
