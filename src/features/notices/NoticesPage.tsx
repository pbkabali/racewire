import { useEvent } from '../events/useEvent'
import { NoticeCard } from './NoticeCard'
import { useNotices } from './useNotices'

export function NoticesPage() {
  const event = useEvent()
  const { notices, loading, fromCache, error } = useNotices(event.code)

  if (loading) {
    return <SkeletonList />
  }

  if (error) {
    return (
      <p className="rounded-lg border border-danger bg-surface p-4 text-sm text-danger-text">
        Could not load notices: {error.message}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold tracking-tight text-fg">Notices</h1>
        {fromCache && <span className="text-xs text-fg-subtle">saved copy</span>}
      </div>

      {notices.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
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
        <div key={i} className="h-28 animate-pulse rounded-lg bg-surface" />
      ))}
    </div>
  )
}
