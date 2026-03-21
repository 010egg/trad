import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { MainLayout } from '@/layouts/MainLayout'
import api from '@/lib/api'
import { useRiskStore } from '@/stores/useRiskStore'
import { useTradeStore } from '@/stores/useTradeStore'

type Tab = 'basic' | 'risk' | 'trade'

export function SettingsPage() {
  const location = useLocation()
  const config = useRiskStore((state) => state.config)
  const fetchConfig = useRiskStore((state) => state.fetchConfig)
  const updateConfig = useRiskStore((state) => state.updateConfig)
  const settings = useTradeStore((state) => state.settings)
  const fetchSettings = useTradeStore((state) => state.fetchSettings)
  const updateSettings = useTradeStore((state) => state.updateSettings)
  const [activeTab, setActiveTab] = useState<Tab>('basic')

  // 风控设置状态
  const [maxLoss, setMaxLoss] = useState(2)
  const [dailyLoss, setDailyLoss] = useState(5)
  const [requireReason, setRequireReason] = useState(true)
  const [requireTp, setRequireTp] = useState(false)
  const [maxPositions, setMaxPositions] = useState(3)
  const [maxLeverage, setMaxLeverage] = useState(10)
  const [saved, setSaved] = useState(false)

  // 交易设置状态
  const [tradeMode, setTradeMode] = useState('SIMULATED')
  const [defaultMarket, setDefaultMarket] = useState('SPOT')
  const [defaultLeverage, setDefaultLeverage] = useState(1)
  const [llmEnabled, setLlmEnabled] = useState(false)
  const [llmProvider, setLlmProvider] = useState<'OPENAI' | 'ANTHROPIC'>('OPENAI')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmModel, setLlmModel] = useState('minimax')
  const [llmSystemPrompt, setLlmSystemPrompt] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmHasApiKey, setLlmHasApiKey] = useState(false)
  const [llmApiKeyMasked, setLlmApiKeyMasked] = useState<string | null>(null)
  const [clearLlmApiKey, setClearLlmApiKey] = useState(false)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmTestError, setLlmTestError] = useState('')
  const [llmTestSuccess, setLlmTestSuccess] = useState('')

  useEffect(() => {
    if (!config) void fetchConfig()
    if (!settings) void fetchSettings()
  }, [config, settings, fetchConfig, fetchSettings])

  useEffect(() => {
    if (location.pathname !== '/settings') return
    void fetchSettings()
  }, [location.pathname, fetchSettings])

  useEffect(() => {
    if (config) {
      setMaxLoss(config.max_loss_per_trade)
      setDailyLoss(config.max_daily_loss)
      setRequireReason(config.require_trade_reason)
      setRequireTp(config.require_take_profit)
      setMaxPositions(config.max_open_positions)
      setMaxLeverage(config.max_leverage)
    }
  }, [config])

  useEffect(() => {
    if (settings) {
      setTradeMode(settings.trade_mode)
      setDefaultMarket(settings.default_market)
      setDefaultLeverage(settings.default_leverage)
      setLlmEnabled(settings.llm_enabled)
      setLlmProvider((settings.llm_provider as 'OPENAI' | 'ANTHROPIC') || 'OPENAI')
      setLlmBaseUrl(settings.llm_base_url)
      setLlmModel(settings.llm_model)
      setLlmSystemPrompt(settings.llm_system_prompt || '')
      setLlmHasApiKey(settings.llm_has_api_key)
      setLlmApiKeyMasked(settings.llm_api_key_masked)
      setLlmApiKey('')
      setClearLlmApiKey(false)
    }
  }, [settings])

  const handleSaveRisk = async () => {
    await updateConfig({
      max_loss_per_trade: maxLoss, max_daily_loss: dailyLoss,
      require_trade_reason: requireReason, require_take_profit: requireTp,
      max_open_positions: maxPositions, max_leverage: maxLeverage,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveTrade = async () => {
    await updateSettings({
      trade_mode: tradeMode,
      default_market: defaultMarket,
      default_leverage: defaultLeverage,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveBasic = async () => {
    await updateSettings({
      llm_enabled: llmEnabled,
      llm_provider: llmProvider,
      llm_base_url: llmBaseUrl.trim(),
      llm_model: llmModel.trim() || 'minimax',
      llm_system_prompt: llmSystemPrompt.trim(),
      ...(clearLlmApiKey ? { llm_api_key: '' } : {}),
      ...(llmApiKey.trim() ? { llm_api_key: llmApiKey.trim() } : {}),
    })
    setLlmApiKey('')
    setClearLlmApiKey(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleToggleLlmEnabled = async () => {
    const nextValue = !llmEnabled
    setLlmEnabled(nextValue)
    try {
      await updateSettings({ llm_enabled: nextValue })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setLlmEnabled(!nextValue)
    }
  }

  const handleTestLlmConnection = async () => {
    setLlmTesting(true)
    setLlmTestError('')
    setLlmTestSuccess('')

    try {
      const baseUrl = llmBaseUrl.trim()
      const model = llmModel.trim() || 'minimax'
      const apiKey = llmApiKey.trim()
      const useSavedApiKey = !clearLlmApiKey && !apiKey && llmHasApiKey

      const result: {
        success: boolean
        latency_ms: number
        model: string
        preview: string
      } = await api.post('/trade/settings/llm-test', {
        provider: llmProvider,
        base_url: baseUrl,
        model,
        ...(apiKey ? { api_key: apiKey } : {}),
        use_saved_api_key: useSavedApiKey,
      })

      setLlmTestSuccess(`联通成功，${result.model} 响应 ${result.preview}，耗时 ${result.latency_ms}ms`)
    } catch (error: any) {
      setLlmTestError(error.response?.data?.detail || error.message || '联通性测试失败')
    } finally {
      setLlmTesting(false)
    }
  }

  return (
    <MainLayout>
      <div className="flex h-full">
        {/* 侧栏 */}
        <div className="w-[200px] bg-[var(--color-bg-card)] border-r border-[var(--color-border)] py-4">
          <div className="space-y-1">
            <button
              onClick={() => setActiveTab('basic')}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm no-underline transition-colors ${
                activeTab === 'basic'
                  ? 'text-[var(--color-accent)] bg-[rgba(88,166,255,0.12)] border-l-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              基础设置
            </button>
            <button
              onClick={() => setActiveTab('risk')}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm no-underline transition-colors ${
                activeTab === 'risk'
                  ? 'text-[var(--color-accent)] bg-[rgba(88,166,255,0.12)] border-l-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              风控设置
            </button>
            <button
              onClick={() => setActiveTab('trade')}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm no-underline transition-colors ${
                activeTab === 'trade'
                  ? 'text-[var(--color-accent)] bg-[rgba(88,166,255,0.12)] border-l-2 border-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              交易设置
            </button>
          </div>
        </div>

        {/* 主内容 */}
        <div className="flex-1 overflow-y-auto p-8 max-w-[720px]">
          {activeTab === 'basic' && (
            <>
              <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
                <h1 className="text-2xl font-semibold mb-1">基础设置</h1>
                <p className="text-sm text-[var(--color-text-secondary)]">管理系统级接入能力和全局行为，不和交易参数混在一起。</p>
              </div>

              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">AI 情报接入</h2>
                <div className="flex items-center justify-between py-4 border-b border-[var(--color-border)]">
                  <div className="flex-1 mr-6">
                    <div className="font-medium mb-0.5">启用 AI 摘要与打分</div>
                    <div className="text-xs text-[var(--color-text-disabled)]">用于情报页的摘要、方向判断和置信度输出，不会自动下单。</div>
                  </div>
                  <div
                    onClick={() => void handleToggleLlmEnabled()}
                    className={`w-10 h-[22px] rounded-full relative cursor-pointer transition-colors ${llmEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-input)] border border-[var(--color-border)]'}`}
                  >
                    <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform ${llmEnabled ? 'right-[2px]' : 'left-[2px]'}`} />
                  </div>
                </div>

                <div className="py-4 border-b border-[var(--color-border)]">
                  <div className="font-medium mb-1">协议</div>
                  <div className="text-xs text-[var(--color-text-disabled)] mb-3">MiniMax 官方推荐 Anthropic 兼容协议；如果你用的是 OpenAI SDK 生态，也可以切到 OpenAI 兼容。</div>
                  <select
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value as 'OPENAI' | 'ANTHROPIC')}
                    className="font-[var(--font-mono)]"
                  >
                    <option value="ANTHROPIC">Anthropic Compatible</option>
                    <option value="OPENAI">OpenAI Compatible</option>
                  </select>
                </div>

                <div className="py-4 border-b border-[var(--color-border)]">
                  <div className="font-medium mb-1">Base URL</div>
                  <div className="text-xs text-[var(--color-text-disabled)] mb-3">
                    {llmProvider === 'ANTHROPIC'
                      ? '中国站：`https://api.minimaxi.com/anthropic`，国际站：`https://api.minimax.io/anthropic`'
                      : '中国站：`https://api.minimaxi.com/v1`，国际站：`https://api.minimax.io/v1`'}
                  </div>
                  <input
                    value={llmBaseUrl}
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    placeholder={llmProvider === 'ANTHROPIC' ? 'https://api.minimaxi.com/anthropic' : 'https://api.minimaxi.com/v1'}
                    className="font-[var(--font-mono)]"
                  />
                </div>

                <div className="py-4 border-b border-[var(--color-border)]">
                  <div className="font-medium mb-1">模型名称</div>
                  <div className="text-xs text-[var(--color-text-disabled)] mb-3">
                    {llmProvider === 'ANTHROPIC'
                      ? 'Anthropic 兼容可用例如 `MiniMax-M2.7`。'
                      : 'OpenAI 兼容可用例如 `MiniMax-M2.5`。'}
                  </div>
                  <input
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    placeholder={llmProvider === 'ANTHROPIC' ? 'MiniMax-M2.7' : 'MiniMax-M2.5'}
                    className="font-[var(--font-mono)]"
                  />
                </div>

                <div className="py-4">
                  <div className="font-medium mb-1">系统提示词</div>
                  <div className="text-xs text-[var(--color-text-disabled)] mb-3">
                    这里就是实际发给模型的唯一系统提示词来源。情报摘要和 AI 对话都会直接使用它，用户只从这里维护。
                  </div>
                  <textarea
                    value={llmSystemPrompt}
                    onChange={(e) => setLlmSystemPrompt(e.target.value)}
                    rows={5}
                    placeholder="例如：全部用中文。先给一句话结论，再写影响逻辑、风险点、观察清单。偏谨慎，不要给绝对化判断。"
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-accent)]"
                  />
                  <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-xs leading-6 text-[var(--color-text-secondary)]">
                    提示：摘要是否返回 JSON、聊天是否按结构回答，这些格式要求会跟随每次具体任务一起下发；系统级人格和风格只看这里这一份。
                  </div>
                </div>

                <div className="py-4">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="font-medium">API Key</div>
                    {llmHasApiKey && !clearLlmApiKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setClearLlmApiKey(true)
                          setLlmApiKey('')
                        }}
                        className="text-xs font-bold text-[var(--color-short)] hover:underline"
                      >
                        清空已保存密钥
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-disabled)] mb-3">
                    {clearLlmApiKey
                      ? '保存后将移除已存密钥。'
                      : llmHasApiKey
                        ? `当前已保存：${llmApiKeyMasked || '***'}，留空则保持不变。`
                        : '未保存密钥。'}
                  </div>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => {
                      setLlmApiKey(e.target.value)
                      if (clearLlmApiKey) setClearLlmApiKey(false)
                    }}
                    placeholder={llmHasApiKey && !clearLlmApiKey ? '留空则保留当前密钥' : '输入 API Key'}
                    className="font-[var(--font-mono)]"
                  />

                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleTestLlmConnection()}
                      disabled={llmTesting}
                      className="px-3 py-2 rounded border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] bg-[var(--color-bg-card)] cursor-pointer hover:border-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {llmTesting ? '测试中...' : '测试联通性'}
                    </button>
                    <span className="text-xs text-[var(--color-text-disabled)]">直接使用当前表单内容测试，不要求先保存；总开关会立即保存。</span>
                  </div>

                  {llmTestSuccess && (
                    <div className="mt-3 rounded-lg border border-[var(--color-long)]/20 bg-[var(--color-long)]/10 px-3 py-2 text-sm text-[var(--color-long)]">
                      {llmTestSuccess}
                    </div>
                  )}
                  {llmTestError && (
                    <div className="mt-3 rounded-lg border border-[var(--color-short)]/20 bg-[var(--color-short)]/10 px-3 py-2 text-sm text-[var(--color-short)]">
                      {llmTestError}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'risk' && (
            <>
              <h1 className="text-2xl font-semibold mb-1">风控设置</h1>
              <p className="text-sm text-[var(--color-text-secondary)] mb-8">风控规则触发后将强制执行，无法临时绕过。</p>

              {/* 仓位控制 */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">仓位控制</h2>
                <div className="flex items-start justify-between py-4 border-b border-[var(--color-border)]">
                  <div className="flex-1 mr-6">
                    <div className="font-medium mb-0.5">单笔最大亏损</div>
                    <div className="text-xs text-[var(--color-text-disabled)]">系统将根据此值和止损距离自动计算推荐仓位</div>
                  </div>
                  <div className="flex items-center gap-2"><input type="number" value={maxLoss} onChange={(e) => setMaxLoss(+e.target.value)} className="!w-20 text-center font-[var(--font-mono)]" /><span className="text-sm text-[var(--color-text-secondary)]">%</span></div>
                </div>
                <div className="flex items-start justify-between py-4 border-b border-[var(--color-border)]">
                  <div className="flex-1 mr-6">
                    <div className="font-medium mb-0.5">日亏损上限</div>
                    <div className="text-xs text-[var(--color-text-disabled)]">当日累计亏损达到此比例后锁定开仓</div>
                  </div>
                  <div className="flex items-center gap-2"><input type="number" value={dailyLoss} onChange={(e) => setDailyLoss(+e.target.value)} className="!w-20 text-center font-[var(--font-mono)]" /><span className="text-sm text-[var(--color-text-secondary)]">%</span></div>
                </div>
              </div>

              {/* 强制规则 */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">强制规则</h2>
                <div className="flex items-center justify-between py-4 border-b border-[var(--color-border)]">
                  <div><div className="font-medium mb-0.5">强制设置止损</div><div className="text-xs text-[var(--color-text-disabled)]">不可关闭</div></div>
                  <div className="w-10 h-[22px] rounded-full bg-[var(--color-accent)] relative cursor-not-allowed opacity-60">
                    <div className="absolute top-[2px] right-[2px] w-4 h-4 rounded-full bg-white" />
                  </div>
                </div>
                <div className="flex items-center justify-between py-4 border-b border-[var(--color-border)]">
                  <div><div className="font-medium mb-0.5">强制填写交易理由</div><div className="text-xs text-[var(--color-text-disabled)]">记录判断依据和心理状态</div></div>
                  <div onClick={() => setRequireReason(!requireReason)}
                    className={`w-10 h-[22px] rounded-full relative cursor-pointer transition-colors ${requireReason ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-input)] border border-[var(--color-border)]'}`}>
                    <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform ${requireReason ? 'right-[2px]' : 'left-[2px]'}`} />
                  </div>
                </div>
                <div className="flex items-center justify-between py-4">
                  <div><div className="font-medium mb-0.5">强制设置止盈</div></div>
                  <div onClick={() => setRequireTp(!requireTp)}
                    className={`w-10 h-[22px] rounded-full relative cursor-pointer transition-colors ${requireTp ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-input)] border border-[var(--color-border)]'}`}>
                    <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white transition-transform ${requireTp ? 'right-[2px]' : 'left-[2px]'}`} />
                  </div>
                </div>
              </div>

              {/* 高级设置 */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">高级设置</h2>
                <div className="flex items-start justify-between py-4 border-b border-[var(--color-border)]">
                  <div><div className="font-medium mb-0.5">最大同时持仓数</div></div>
                  <div className="flex items-center gap-2"><input type="number" value={maxPositions} onChange={(e) => setMaxPositions(+e.target.value)} className="!w-20 text-center font-[var(--font-mono)]" /><span className="text-sm text-[var(--color-text-secondary)]">笔</span></div>
                </div>
                <div className="flex items-start justify-between py-4">
                  <div><div className="font-medium mb-0.5">最大杠杆倍数</div></div>
                  <div className="flex items-center gap-2"><input type="number" value={maxLeverage} onChange={(e) => setMaxLeverage(+e.target.value)} className="!w-20 text-center font-[var(--font-mono)]" /><span className="text-sm text-[var(--color-text-secondary)]">x</span></div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'trade' && (
            <>
              <div className="flex flex-col gap-4 mb-8 pb-6 border-b border-[var(--color-border)] lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold mb-1">交易设置</h1>
                  <p className="text-sm text-[var(--color-text-secondary)]">配置交易模式和默认市场设置。</p>
                </div>
                <div className="lg:min-w-[280px]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--color-text-disabled)] mb-2">
                    默认市场
                  </div>
                  <div className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black tracking-[0.18em] ${
                    defaultMarket === 'FUTURES'
                      ? 'bg-[var(--color-short)]/10 text-[var(--color-short)] border border-[var(--color-short)]/20'
                      : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20'
                  }`}>
                    {defaultMarket === 'FUTURES' ? '合约 FUTURES' : '现货 SPOT'}
                  </div>
                  <div className="mt-2 text-xs text-[var(--color-text-disabled)]">
                    顶部导航栏可直接切换，点击后立即生效。
                  </div>
                </div>
              </div>

              {/* 交易模式 */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">交易模式</h2>
                <div className="space-y-3">
                  <div
                    onClick={() => setTradeMode('SIMULATED')}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      tradeMode === 'SIMULATED'
                        ? 'border-[var(--color-accent)] bg-[rgba(88,166,255,0.08)]'
                        : 'border-[var(--color-border)] hover:border-[var(--color-text-disabled)]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        tradeMode === 'SIMULATED' ? 'border-[var(--color-accent)]' : 'border-[var(--color-text-disabled)]'
                      }`}>
                        {tradeMode === 'SIMULATED' && <div className="w-3 h-3 rounded-full bg-[var(--color-accent)]" />}
                      </div>
                      <div>
                        <div className="font-medium">模拟交易</div>
                        <div className="text-xs text-[var(--color-text-disabled)]">使用模拟账户进行交易，不涉及真实资金</div>
                      </div>
                    </div>
                  </div>
                  <div
                    onClick={() => setTradeMode('LIVE')}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      tradeMode === 'LIVE'
                        ? 'border-[var(--color-accent)] bg-[rgba(88,166,255,0.08)]'
                        : 'border-[var(--color-border)] hover:border-[var(--color-text-disabled)]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        tradeMode === 'LIVE' ? 'border-[var(--color-accent)]' : 'border-[var(--color-text-disabled)]'
                      }`}>
                        {tradeMode === 'LIVE' && <div className="w-3 h-3 rounded-full bg-[var(--color-accent)]" />}
                      </div>
                      <div>
                        <div className="font-medium text-[var(--color-short)]">实盘交易</div>
                        <div className="text-xs text-[var(--color-text-disabled)]">使用真实账户进行交易，涉及真实资金</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 市场设置 */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">市场设置</h2>
                <div className="flex items-start justify-between py-4 border-b border-[var(--color-border)]">
                  <div className="flex-1 mr-6">
                    <div className="font-medium mb-0.5">当前默认市场</div>
                    <div className="text-xs text-[var(--color-text-disabled)]">已移动到顶部标题栏快速切换</div>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-black tracking-wider ${
                    defaultMarket === 'FUTURES'
                      ? 'bg-[var(--color-short)]/10 text-[var(--color-short)] border border-[var(--color-short)]/20'
                      : 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20'
                  }`}>
                    {defaultMarket === 'FUTURES' ? '合约 FUTURES' : '现货 SPOT'}
                  </div>
                </div>
                {defaultMarket === 'FUTURES' && (
                  <div className="flex items-start justify-between py-4">
                    <div className="flex-1 mr-6">
                      <div className="font-medium mb-0.5">默认杠杆</div>
                      <div className="text-xs text-[var(--color-text-disabled)]">合约交易的默认杠杆倍数</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={defaultLeverage}
                        onChange={(e) => setDefaultLeverage(Math.max(1, Math.min(125, +e.target.value)))}
                        min={1}
                        max={125}
                        className="!w-20 text-center font-[var(--font-mono)]"
                      />
                      <span className="text-sm text-[var(--color-text-secondary)]">x</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 保存 */}
          <div className="sticky bottom-0 bg-[var(--color-bg-card)] border-t border-[var(--color-border)] py-4 flex justify-end gap-2">
            {saved && <span className="text-sm text-[var(--color-long)] self-center mr-2">✓ 已保存</span>}
            <button
              onClick={activeTab === 'basic' ? handleSaveBasic : activeTab === 'risk' ? handleSaveRisk : handleSaveTrade}
              className="px-4 py-2 bg-[var(--color-accent)] text-white rounded cursor-pointer hover:opacity-90 border-none"
            >
              {activeTab === 'basic' ? '保存基础设置' : activeTab === 'risk' ? '保存风控设置' : '保存交易设置'}
            </button>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
