export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8 animate-pulse">
      <div className="h-9 w-48 rounded-2xl bg-[var(--skeleton-block)]" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-28 rounded-3xl bg-[var(--skeleton-block)]" />
        ))}
      </div>
      <div className="rounded-3xl bg-[var(--skeleton-block)] p-6 space-y-4">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-[var(--skeleton-line)]" style={{ width: `${85 - i * 5}%` }} />
        ))}
      </div>
    </div>
  )
}
