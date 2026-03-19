import { useState } from 'react'
import { useNavigate } from 'react-router'
import api from '@/lib/api'
import { useRiskStore } from '@/stores/useRiskStore'

export function SetupPage() {
  const [step, setStep] = useState(1)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [connected, setConnected] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [maxLoss, setMaxLoss] = useState(2)
  const [dailyLoss, setDailyLoss] = useState(5)
  const [requireReason, setRequireReason] = useState(true)
  const [requireTp, setRequireTp] = useState(false)
  const updateConfig = useRiskStore((state) => state.updateConfig)
  const navigate = useNavigate()

  const handleVerify = async () => {
    setVerifying(true)
    setConnectError('')
    try {
      // 保存 API Key
      await api.post('/account/api-keys', { api_key: apiKey, api_secret: apiSecret })
      // 验证连接时强制读取实盘现货余额，避免默认模拟模式返回 10000
      const balance: { balance: number } = await api.get('/account/balance', {
        params: {
          trade_mode: 'LIVE',
          market: 'SPOT',
        },
      })
      setBalance(balance.balance)
      setConnected(true)
    } catch (e: any) {
      setConnectError(e.response?.data?.detail || '连接失败，请检查 API Key 是否正确')
      setConnected(false)
    }
    setVerifying(false)
  }

  const handleSaveRisk = async () => {
    await updateConfig({
      max_loss_per_trade: maxLoss,
      max_daily_loss: dailyLoss,
      require_trade_reason: requireReason,
      require_take_profit: requireTp,
    })
    setStep(3)
  }

  const stepDot = (n: number) => {
    if (n < step) return 'w-7 h-7 rounded-full border-2 border-[var(--color-long)] bg-[rgba(63,182,139,0.12)] text-[var(--color-long)] flex items-center justify-center text-xs font-semibold'
    if (n === step) return 'w-7 h-7 rounded-full border-2 border-[var(--color-accent)] bg-[rgba(88,166,255,0.12)] text-[var(--color-accent)] flex items-center justify-center text-xs font-semibold'
    return 'w-7 h-7 rounded-full border-2 border-[var(--color-border)] text-[var(--color-text-disabled)] flex items-center justify-center text-xs font-semibold'
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-[520px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-8">
        {/* 步骤指示器 */}
        <div className="flex items-center gap-4 mb-8">
          <div className="flex items-center gap-2">
            <div className={stepDot(1)}>{step > 1 ? '✓' : '1'}</div>
            <span className={`text-sm ${step >= 1 ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-disabled)]'}`}>绑定 API</span>
          </div>
          <div className="w-10 h-0.5 bg-[var(--color-border)]" />
          <div className="flex items-center gap-2">
            <div className={stepDot(2)}>{step > 2 ? '✓' : '2'}</div>
            <span className={`text-sm ${step >= 2 ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-disabled)]'}`}>风控设置</span>
          </div>
          <div className="w-10 h-0.5 bg-[var(--color-border)]" />
          <div className="flex items-center gap-2">
            <div className={stepDot(3)}>3</div>
            <span className={`text-sm ${step >= 3 ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-disabled)]'}`}>完成</span>
          </div>
        </div>

        {/* 步骤 1 */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">绑定你的 Binance API Key</h2>
            <div className="mb-4">
              <label className="block text-sm text-[var(--color-text-secondary)] mb-1">API Key</label>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="输入你的 Binance API Key" />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-[var(--color-text-secondary)] mb-1">API Secret</label>
              <input type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="输入你的 Binance API Secret" />
            </div>
            <div className="p-3 rounded-lg bg-[rgba(210,153,34,0.12)] border border-[rgba(210,153,34,0.2)] text-[var(--color-warning)] text-sm mb-4 flex gap-2">
              <span>⚠</span>
              <span>建议仅开启交易权限，关闭提现权限。</span>
            </div>
            {connected && balance !== null && (
              <div className="p-3 rounded-lg bg-[rgba(63,182,139,0.12)] border border-[rgba(63,182,139,0.2)] text-[var(--color-long)] text-sm mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-long)]" />
                  连接成功！
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  账户余额: {balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                </div>
              </div>
            )}
            {connectError && (
              <div className="p-3 rounded-lg bg-[rgba(255,104,56,0.12)] border border-[rgba(255,104,56,0.2)] text-[var(--color-short)] text-sm mb-4">
                {connectError}
              </div>
            )}
            <div className="flex justify-between mt-6 pt-6 border-t border-[var(--color-border)]">
              <button onClick={() => navigate('/login')} className="px-4 py-2 border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] bg-transparent cursor-pointer hover:border-[var(--color-text-secondary)]">← 返回登录</button>
              {connected ? (
                <button onClick={() => setStep(2)} className="px-4 py-2 bg-[var(--color-accent)] text-white rounded cursor-pointer hover:opacity-90">下一步 →</button>
              ) : (
                <button onClick={handleVerify} disabled={verifying} className="px-4 py-2 bg-[var(--color-accent)] text-white rounded cursor-pointer hover:opacity-90 disabled:opacity-50">
                  {verifying ? '验证中...' : '验证连接'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 步骤 2 */}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold mb-4 pb-2 border-b border-[var(--color-border)]">风控规则设置</h2>
            <div className="flex items-center gap-4 mb-4">
              <label className="flex-1">单笔最大亏损</label>
              <input type="number" value={maxLoss} onChange={(e) => setMaxLoss(+e.target.value)} className="!w-20 text-center font-[var(--font-mono)]" />
              <span className="text-sm text-[var(--color-text-secondary)]">%</span>
              <span className="text-xs text-[var(--color-text-disabled)]">建议 1%~3%</span>
            </div>
            <div className="flex items-center gap-4 mb-6">
              <label className="flex-1">日亏损上限</label>
              <input type="number" value={dailyLoss} onChange={(e) => setDailyLoss(+e.target.value)} className="!w-20 text-center font-[var(--font-mono)]" />
              <span className="text-sm text-[var(--color-text-secondary)]">%</span>
              <span className="text-xs text-[var(--color-text-disabled)]">触发后禁止开仓</span>
            </div>
            <div className="text-xs text-[var(--color-text-disabled)] uppercase tracking-wider mb-3 font-medium">强制规则</div>
            <div className="flex flex-col gap-3 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked disabled className="!w-4 accent-[var(--color-accent)]" />
                <span>下单时必须设置止损</span>
                <span className="ml-auto text-xs text-[var(--color-text-disabled)]">不可关闭</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={requireReason} onChange={(e) => setRequireReason(e.target.checked)} className="!w-4 accent-[var(--color-accent)]" />
                <span>下单时必须填写交易理由</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={requireTp} onChange={(e) => setRequireTp(e.target.checked)} className="!w-4 accent-[var(--color-accent)]" />
                <span>下单时必须设置止盈</span>
              </label>
            </div>
            <div className="p-3 rounded-lg bg-[rgba(210,153,34,0.12)] border border-[rgba(210,153,34,0.2)] text-[var(--color-warning)] text-sm flex gap-2">
              <span>⚠</span><span>风控规则触发后将强制执行，无法临时绕过。</span>
            </div>
            <div className="flex justify-between mt-6 pt-6 border-t border-[var(--color-border)]">
              <button onClick={() => setStep(1)} className="px-4 py-2 border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] bg-transparent cursor-pointer">← 上一步</button>
              <button onClick={handleSaveRisk} className="px-4 py-2 bg-[var(--color-accent)] text-white rounded cursor-pointer hover:opacity-90">下一步 →</button>
            </div>
          </div>
        )}

        {/* 步骤 3 */}
        {step === 3 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-[rgba(63,182,139,0.12)] rounded-full flex items-center justify-center text-3xl text-[var(--color-long)] mx-auto mb-6">✓</div>
            <h2 className="text-xl font-semibold mb-2">设置完成</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">你是一个风险管理系统操作员，不是赌徒。</p>
            <div className="bg-[var(--color-bg-input)] rounded-lg p-4 text-left text-sm mb-6">
              <div className="text-xs text-[var(--color-text-disabled)] mb-2">配置摘要</div>
              <div className="flex justify-between py-1"><span className="text-[var(--color-text-secondary)]">Binance API</span><span className="text-[var(--color-long)]">✓ 已连接</span></div>
              {balance !== null && <div className="flex justify-between py-1"><span className="text-[var(--color-text-secondary)]">账户余额</span><span className="font-[var(--font-mono)]">{balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</span></div>}
              <div className="flex justify-between py-1"><span className="text-[var(--color-text-secondary)]">单笔最大亏损</span><span className="font-[var(--font-mono)]">{maxLoss}%</span></div>
              <div className="flex justify-between py-1"><span className="text-[var(--color-text-secondary)]">日亏损上限</span><span className="font-[var(--font-mono)]">{dailyLoss}%</span></div>
              <div className="flex justify-between py-1"><span className="text-[var(--color-text-secondary)]">强制止损</span><span className="text-[var(--color-long)]">✓ 开启</span></div>
            </div>
            <button onClick={() => navigate('/')} className="w-full py-3 bg-[var(--color-accent)] text-white rounded font-medium cursor-pointer hover:opacity-90">
              进入行情看板 →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
