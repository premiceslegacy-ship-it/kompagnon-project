export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <p className="text-sm text-secondary animate-pulse">Chargement…</p>
      </div>
    </div>
  )
}
