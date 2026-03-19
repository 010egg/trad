import { useState } from 'react'
import { useAccountStore } from '@/stores/useAccountStore'
import { useRiskStore } from '@/stores/useRiskStore'
import { useMarketStore } from '@/stores/useMarketStore'

export function OrderForm() {
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG')
  const [orderType, setOrderType] = useState('LIMIT')
  const [price, setPrice] = useState<string>('')
  const [stopLoss, setStopLoss] = useState<string>('')
  const [takeProfit, setTakeProfit] = useState<string>('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const { createOrder, fetchPositions } = useAccountStore()
  const { checkRisk } = useRiskStore()
  const symbol = useMarketStore((state) => state.symbol)

  const handleInputChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    // 允许数字、小数点和空字符串
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setter(val)
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!stopLoss) { setError('必须设置止损'); return }
    if (!reason.trim()) { setError('必须填写交易理由'); return }

    const entryPrice = parseFloat(price) || 0
    const sl = parseFloat(stopLoss) || 0

    // 风控检查
    const riskResult = await checkRisk({
      symbol, side: side === 'LONG' ? 'BUY' : 'SELL',
      quantity: 0.01, stop_loss: sl, entry_price: entryPrice, account_balance: 10000,
    })
    if (!riskResult.allowed) { setError(riskResult.reason || '风控检查不通过'); return }

    setSubmitting(true)
    try {
      await createOrder({
        symbol, side: side === 'LONG' ? 'BUY' : 'SELL', position_side: side,
        order_type: orderType, quantity: riskResult.recommended_quantity || 0.01,
        price: entryPrice || undefined, stop_loss: sl,
        take_profit: takeProfit ? parseFloat(takeProfit) : undefined,
        trade_reason: reason,
      })
      setReason('')
      fetchPositions()
    } catch { setError('下单失败') }
    setSubmitting(false)
  }

  return (
    <div className="p-5 border-b border-[var(--color-border)] bg-gradient-to-b from-transparent to-[var(--color-bg-hover)]/10">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-widest font-bold">新建仓位</span>
        <span className="text-[10px] text-[var(--color-text-disabled)] font-medium">现货 / 逐仓</span>
      </div>

      {/* 方向切换 - 更加专业的切换器 */}
      <div className="flex p-1 bg-[var(--color-bg-input)] rounded-lg mb-5 shadow-inner">
        <button
          onClick={() => setSide('LONG')}
          className={`flex-1 py-2.5 rounded-md text-xs font-black transition-all cursor-pointer ${
            side === 'LONG'
              ? 'bg-[var(--color-long)] text-white shadow-lg shadow-[var(--color-long)]/20 translate-y-[-1px]'
              : 'bg-transparent text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          做多 / 买入
        </button>
        <button
          onClick={() => setSide('SHORT')}
          className={`flex-1 py-2.5 rounded-md text-xs font-black transition-all cursor-pointer ${
            side === 'SHORT'
              ? 'bg-[var(--color-short)] text-white shadow-lg shadow-[var(--color-short)]/20 translate-y-[-1px]'
              : 'bg-transparent text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)]'
          }`}
        >
          做空 / 卖出
        </button>
      </div>

      {/* 表单区域 */}
      <div className="space-y-3.5">
        <div className="flex items-center gap-3">
          <label className="w-10 text-[10px] font-bold text-[var(--color-text-disabled)] uppercase shrink-0">类型</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value)}
            className="flex-1 text-sm font-bold bg-[var(--color-bg-input)]/50 border-[var(--color-border)] rounded-md py-1.5 px-2 hover:border-[var(--color-text-disabled)] transition-colors appearance-none cursor-pointer"
          >
            <option value="LIMIT">限价委托 (Limit)</option>
            <option value="MARKET">市价委托 (Market)</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <label className="w-10 text-[10px] font-bold text-[var(--color-text-disabled)] uppercase shrink-0">价格</label>
          <div className="flex-1 relative group">
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={handleInputChange(setPrice)}
              placeholder="0.00"
              className="w-full pl-3 pr-12 py-2 text-sm font-bold font-[var(--font-mono)] bg-[var(--color-bg-input)]/50 border-[var(--color-border)] rounded-md focus:ring-1 focus:ring-[var(--color-accent)]/50 focus:border-[var(--color-accent)] transition-all"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[var(--color-text-disabled)] group-focus-within:text-[var(--color-text-secondary)]">USDT</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="w-10 text-[10px] font-bold text-[var(--color-short)]/80 uppercase shrink-0">止损 *</label>
          <div className="flex-1 relative">
            <input
              type="text"
              inputMode="decimal"
              value={stopLoss}
              onChange={handleInputChange(setStopLoss)}
              placeholder="强制止损价"
              className="w-full pl-3 pr-12 py-2 text-sm font-bold font-[var(--font-mono)] bg-[var(--color-bg-input)]/50 border-[var(--color-short)]/30 rounded-md focus:ring-1 focus:ring-[var(--color-short)]/50 focus:border-[var(--color-short)] transition-all placeholder:text-[var(--color-short)]/30"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[var(--color-short)]/40">USDT</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="w-10 text-[10px] font-bold text-[var(--color-text-disabled)] uppercase shrink-0">止盈</label>
          <div className="flex-1 relative">
            <input
              type="text"
              inputMode="decimal"
              value={takeProfit}
              onChange={handleInputChange(setTakeProfit)}
              placeholder="可选止盈价"
              className="w-full pl-3 pr-12 py-2 text-sm font-bold font-[var(--font-mono)] bg-[var(--color-bg-input)]/50 border-[var(--color-border)] rounded-md focus:ring-1 focus:ring-[var(--color-long)]/50 focus:border-[var(--color-long)] transition-all"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[var(--color-text-disabled)]">USDT</span>
          </div>
        </div>

        {/* 交易理由 */}
        <div className="pt-2">
          <label className="block text-[10px] font-bold text-[var(--color-text-disabled)] uppercase mb-2 tracking-wider">交易理由 <span className="text-[var(--color-danger)]">*</span></label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="请在此记录您的入场逻辑（必填）..."
            className="w-full p-3 text-xs font-medium bg-[var(--color-bg-input)]/30 border-[var(--color-border)] rounded-md resize-none focus:bg-[var(--color-bg-input)]/50 transition-all placeholder:italic"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-2.5 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded text-[11px] text-[var(--color-danger)] font-bold">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`w-full py-3.5 rounded-lg font-black text-xs tracking-widest transition-all cursor-pointer border-none text-white flex items-center justify-center gap-2 ${
            side === 'LONG'
              ? 'bg-[var(--color-long)] hover:shadow-lg hover:shadow-[var(--color-long)]/20 active:translate-y-[1px]'
              : 'bg-[var(--color-short)] hover:shadow-lg hover:shadow-[var(--color-short)]/20 active:translate-y-[1px]'
          } disabled:opacity-50 disabled:translate-y-0`}
        >
          {submitting ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              {side === 'LONG' ? '确认下单 (做多)' : '确认下单 (做空)'}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
