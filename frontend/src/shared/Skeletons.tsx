function SkeletonBox({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-[var(--color-bg-input)] rounded ${className}`}
      aria-hidden="true"
    />
  )
}

export function PageSpinner() {
  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-[var(--color-text-disabled)]">加载中...</span>
      </div>
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="h-10 border-b border-[var(--color-border)] px-4 flex items-center gap-4">
        <SkeletonBox className="h-6 w-24" />
        <div className="flex gap-1">
          {['1m', '5m', '15m', '1h', '4h', '1d'].map((_, i) => (
            <SkeletonBox key={i} className="h-6 w-8" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-4">
        <SkeletonBox className="w-full h-full rounded-lg" />
      </div>
    </div>
  )
}

export function OrderFormSkeleton() {
  return (
    <div className="p-4 border-b border-[var(--color-border)]">
      <SkeletonBox className="h-4 w-20 mb-3" />
      <div className="flex gap-0.5 mb-3 bg-[var(--color-bg-input)] p-0.5 rounded">
        <SkeletonBox className="flex-1 h-8 rounded" />
        <SkeletonBox className="flex-1 h-8 rounded" />
      </div>
      {[60, 60, 60, 60].map((_, i) => (
        <SkeletonBox key={i} className="h-8 w-full mb-2" />
      ))}
      <SkeletonBox className="h-10 w-full mt-2 rounded" />
    </div>
  )
}

export function PositionsSkeleton() {
  return (
    <div className="bg-[var(--color-bg-card)] border-t border-[var(--color-border)] max-h-[200px] overflow-y-auto shrink-0 p-4">
      <div className="flex items-center justify-between mb-3">
        <SkeletonBox className="h-4 w-32" />
        <SkeletonBox className="h-4 w-20" />
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((_, i) => (
          <SkeletonBox key={i} className="h-10 w-full rounded" />
        ))}
      </div>
    </div>
  )
}

export function AccountOverviewSkeleton() {
  return (
    <div className="p-4 border-b border-[var(--color-border)]">
      <SkeletonBox className="h-4 w-20 mb-3" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <SkeletonBox className="h-3 w-16 mb-1" />
          <SkeletonBox className="h-5 w-28" />
          <SkeletonBox className="h-3 w-20 mt-1" />
        </div>
        <div>
          <SkeletonBox className="h-3 w-12 mb-1" />
          <SkeletonBox className="h-5 w-8" />
        </div>
      </div>
    </div>
  )
}
