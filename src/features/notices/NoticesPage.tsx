import { NoticeCard } from './NoticeCard'
import { useNotices } from './useNotices'

export function NoticesPage() {
  const { notices, loading, fromCache, error } = useNotices()

  if (loading) {
    return <SkeletonList />
  }

  if (error) {
    return (
      <p className="rounded-lg border border-flag-red-dim bg-asphalt p-4 text-sm text-flag-red">
        Could not load notices: {error.message}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight text-zinc-100">Notices</h1>
        {fromCache && <span className="text-xs text-zinc-500">saved copy</span>}
      </div>

      {notices.length === 0 ? (
        <p className="rounded-lg border border-asphalt-light bg-asphalt p-6 text-center text-sm text-zinc-400">
          No notices yet. Anything the organisers post will appear here.
        </p>
      ) : (
        notices.map((notice) => <NoticeCard key={notice.id} notice={notice} />)
      )}
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading notices">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-lg bg-asphalt" />
      ))}
    </div>
  )
}
