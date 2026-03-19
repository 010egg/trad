import { describe, expect, it } from 'vitest'
import { mergeLatestKlines, type Kline } from '@/stores/useMarketStore'

function createKline(time: number, close = time): Kline {
  return {
    time,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }
}

describe('mergeLatestKlines', () => {
  it('replaces the latest candle when the timestamp matches', () => {
    const prev = [createKline(1, 100), createKline(2, 200)]
    const incoming = [createKline(2, 250)]

    expect(mergeLatestKlines(prev, incoming)).toEqual([
      createKline(1, 100),
      createKline(2, 250),
    ])
  })

  it('appends new candles and keeps only the latest 500 points', () => {
    const prev = Array.from({ length: 500 }, (_, index) => createKline(index + 1))
    const incoming = [createKline(501)]

    const merged = mergeLatestKlines(prev, incoming)

    expect(merged).toHaveLength(500)
    expect(merged[0]?.time).toBe(2)
    expect(merged.at(-1)?.time).toBe(501)
  })
})
