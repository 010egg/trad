import { useEffect, useState } from 'react'
import { MainLayout } from '@/layouts/MainLayout'
import { useRiskStore } from '@/stores/useRiskStore'
import { useTradeStore } from '@/stores/useTradeStore'

type Tab = 'risk' | 'trade'

export function SettingsPage() {
  const config = useRiskStore((state) => state.config)
  const fetchConfig = useRiskStore((state) => state.fetchConfig)
  const updateConfig = useRiskStore((state) => state.updateConfig)
  const settings = useTradeStore((state) => state.settings)
  const fetchSettings = useTradeStore((state) => state.fetchSettings)
  const updateSettings = useTradeStore((state) => state.updateSettings)
  const [activeTab, setActiveTab] = useState<Tab>('risk')

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

  useEffect(() => {
    if (!config) void fetchConfig()
    if (!settings) void fetchSettings()
  }, [config, settings, fetchConfig, fetchSettings])

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

  return (
    <MainLayout>
      <div className="flex h-full">
        {/* 侧栏 */}
        <div className="w-[200px] bg-[var(--color-bg-card)] border-r border-[var(--color-border)] py-4">
          <div className="space-y-1">
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
              <h1 className="text-2xl font-semibold mb-1">交易设置</h1>
              <p className="text-sm text-[var(--color-text-secondary)] mb-8">配置交易模式和默认市场设置。</p>

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
                    <div className="font-medium mb-0.5">交易市场</div>
                    <div className="text-xs text-[var(--color-text-disabled)]">选择默认交易的市场类型</div>
                  </div>
                  <select
                    value={defaultMarket}
                    onChange={(e) => setDefaultMarket(e.target.value)}
                    className="!w-32"
                  >
                    <option value="SPOT">现货 (Spot)</option>
                    <option value="FUTURES">合约 (Futures)</option>
                  </select>
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
              onClick={activeTab === 'risk' ? handleSaveRisk : handleSaveTrade}
              className="px-4 py-2 bg-[var(--color-accent)] text-white rounded cursor-pointer hover:opacity-90 border-none"
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
