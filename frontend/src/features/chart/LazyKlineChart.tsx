import { lazy, Suspense } from 'react'
import { ChartSkeleton } from '@/shared/Skeletons'
import type { IndicatorConfig } from '@/features/chart/KlineChart'

const KlineChart = lazy(() => import('@/features/chart/KlineChart').then(m => ({ default: m.KlineChart })))

export type { IndicatorConfig }

interface LazyKlineChartProps {
  indicators?: IndicatorConfig[]
}

export function LazyKlineChart(props: LazyKlineChartProps) {
  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <Suspense fallback={<ChartSkeleton />}>
        <KlineChart {...props} />
      </Suspense>
    </div>
  )
}
