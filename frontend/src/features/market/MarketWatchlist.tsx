import { useEffect } from 'react'
import { useMarketStore } from '@/stores/useMarketStore'
import { FlashText } from '@/shared/FlashText'

const WATCHLIST_REFRESH_MS = 3000

export function MarketWatchlist() {
  const symbols = useMarketStore((state) => state.symbols)
  const symbol = useMarketStore((state) => state.symbol)
  const fetchKlines = useMarketStore((state) => state.fetchKlines)
  const fetchTickers = useMarketStore((state) => state.fetchTickers)
  const tickerMap = useMarketStore((state) => state.tickerMap)
  const interval = useMarketStore((state) => state.interval)
  const latestKline = useMarketStore((state) => state.latestKline)

  const handleChangeSymbol = (s: string) => void fetchKlines(s, interval)

  useEffect(() => {
    const symbolList = symbols.map((item) => item.symbol)
    if (!symbolList.length) return

    void fetchTickers(symbolList)

    const timer = window.setInterval(() => {
      void fetchTickers(symbolList, { background: true })
    }, WATCHLIST_REFRESH_MS)

    return () => window.clearInterval(timer)
  }, [symbols, fetchTickers])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center justify-between shrink-0 h-10 bg-[var(--color-bg-card)]">
        <span className="text-[10px] font-black text-[var(--color-text-disabled)] uppercase tracking-widest">行情列表</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-disabled)]"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-[var(--color-bg-card)]">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-[var(--color-bg-card)] z-10">
            <tr className="text-[8px] text-[var(--color-text-disabled)] text-left uppercase">
              <th className="pl-3 py-2 font-bold">交易对</th>
              <th className="px-2 py-2 font-bold text-right">价格</th>
              <th className="pr-3 py-2 font-bold text-right">24h%</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => {
              const isSelected = s.symbol === symbol
              const ticker = tickerMap[s.symbol]
              const price = isSelected
                ? (latestKline?.close || ticker?.price || 0)
                : (ticker?.price || 0)
              const change = ticker?.price_change_pct
              
              return (
                <tr key={s.symbol} onClick={() => handleChangeSymbol(s.symbol)}
                  className={`cursor-pointer transition-colors group ${isSelected ? 'bg-[var(--color-accent)]/10' : 'hover:bg-[var(--color-bg-hover)]'}`}>
                  <td className="pl-3 py-2">
                    <div className={`font-black tracking-tighter ${isSelected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>{s.base_asset}</div>
                    <div className="text-[8px] text-[var(--color-text-disabled)] font-bold">/{s.quote_asset}</div>
                  </td>
                  <td className="px-2 py-2 text-right font-[var(--font-mono)] font-bold">
                    <FlashText value={price} className="inline-block">
                      {price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '--'}
                    </FlashText>
                  </td>
                  <td className={`pr-3 py-2 text-right font-[var(--font-mono)] font-bold ${typeof change === 'number' && change >= 0 ? 'text-[var(--color-long)]' : 'text-[var(--color-short)]'}`}>
                    {typeof change === 'number' ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '--'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
