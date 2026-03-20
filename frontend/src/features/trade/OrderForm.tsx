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
    <div className="flex flex-col h-full bg-[var(--color-bg-card)]">
      {/* 1. 方向切换 */}
      <div className="flex p-1 bg-[var(--color-bg-input)]/50 border-b border-[var(--color-border)] shrink-0">
        <button
          onClick={() => setSide('LONG')}
          className={`flex-1 py-2 rounded text-[10px] font-black transition-all cursor-pointer ${
            side === 'LONG'
              ? 'bg-[var(--color-long)] text-white shadow-sm'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          做多 / 买入
        </button>
        <button
          onClick={() => setSide('SHORT')}
          className={`flex-1 py-2 rounded text-[10px] font-black transition-all cursor-pointer ${
            side === 'SHORT'
              ? 'bg-[var(--color-short)] text-white shadow-sm'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          做空 / 卖出
        </button>
      </div>

      <div className="p-4 space-y-5 overflow-y-auto custom-scrollbar flex-1">
        {/* 2. 下单类型 */}
        <div className="flex bg-[var(--color-bg-input)] p-0.5 rounded border border-[var(--color-border)]">
          {[
            { label: '限价', value: 'LIMIT' },
            { label: '市价', value: 'MARKET' }
          ].map((t) => (
            <button
              key={t.value}
              onClick={() => setOrderType(t.value)}
              className={`flex-1 py-1 text-[9px] font-bold rounded transition-all ${
                orderType === t.value 
                  ? 'bg-[var(--color-bg-card)] text-[var(--color-accent)] shadow-sm' 
                  : 'text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 3. 输入框堆栈 - 采用上方标签布局，彻底杜绝重叠 */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between px-0.5">
              <label className="text-[9px] font-black text-[var(--color-text-disabled)] uppercase tracking-widest">价格</label>
              <span className="text-[9px] font-bold text-[var(--color-text-disabled)] opacity-40">USDT</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={handleInputChange(setPrice)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-xs font-black font-[var(--font-mono)] bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded hover:border-[var(--color-text-disabled)] focus:border-[var(--color-accent)] transition-all outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between px-0.5">
              <label className="text-[9px] font-black text-[var(--color-short)] uppercase tracking-widest">止损价</label>
              <span className="text-[8px] font-bold text-[var(--color-short)] opacity-60">必填</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={stopLoss}
              onChange={handleInputChange(setStopLoss)}
              placeholder="触发强制平仓价格"
              className="w-full px-3 py-2 text-xs font-black font-[var(--font-mono)] bg-[var(--color-bg-input)] border border-[var(--color-short)]/30 rounded hover:border-[var(--color-short)]/60 focus:border-[var(--color-short)] transition-all outline-none placeholder:text-[8px] placeholder:font-normal placeholder:opacity-30"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between px-0.5">
              <label className="text-[9px] font-black text-[var(--color-long)] uppercase tracking-widest">止盈价</label>
              <span className="text-[8px] font-bold text-[var(--color-long)] opacity-40">可选</span>
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={takeProfit}
              onChange={handleInputChange(setTakeProfit)}
              placeholder="目标获利价格"
              className="w-full px-3 py-2 text-xs font-black font-[var(--font-mono)] bg-[var(--color-bg-input)] border border-[var(--color-long)]/20 rounded hover:border-[var(--color-long)]/40 focus:border-[var(--color-long)] transition-all outline-none placeholder:text-[8px] placeholder:font-normal placeholder:opacity-30"
            />
          </div>
        </div>

        {/* 4. 交易理由 */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center px-0.5">
            <label className="text-[9px] font-black text-[var(--color-text-disabled)] uppercase tracking-widest">交易理由</label>
            <span className="text-[8px] font-medium text-[var(--color-danger)] opacity-60">* 必填</span>
          </div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="记录您的入场逻辑、指标信号等..."
            className="w-full p-2.5 text-[11px] font-medium bg-[var(--color-bg-input)]/30 border border-[var(--color-border)] rounded-md resize-none focus:bg-[var(--color-bg-input)]/50 focus:border-[var(--color-text-disabled)] transition-all outline-none"
          />
        </div>

        {/* 5. 提交 */}
        <div className="pt-2">
          {error && (
            <div className="mb-3 flex items-start gap-2 p-2 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded text-[10px] text-[var(--color-danger)] font-bold animate-in fade-in slide-in-from-top-1">
              <span className="shrink-0">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`w-full py-3.5 rounded font-black text-[11px] tracking-[0.2em] transition-all cursor-pointer border-none text-white flex items-center justify-center gap-2 ${
              side === 'LONG'
                ? 'bg-[var(--color-long)] hover:shadow-lg hover:shadow-[var(--color-long)]/20 active:scale-[0.98]'
                : 'bg-[var(--color-short)] hover:shadow-lg hover:shadow-[var(--color-short)]/20 active:scale-[0.98]'
            } disabled:opacity-40 shadow-md`}
          >
            {submitting ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              `确认${side === 'LONG' ? '买入' : '卖出'}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
