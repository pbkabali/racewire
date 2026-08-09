import type { Notice, NoticeSeverity } from './types'

const severityStyles: Record<NoticeSeverity, { border: string; chip: string; label: string }> = {
  info: {
    border: 'border-l-zinc-600',
    chip: 'bg-zinc-700 text-zinc-200',
    label: 'Info',
  },
  warning: {
    border: 'border-l-flag-yellow',
    chip: 'bg-flag-yellow text-track-black',
    label: 'Warning',
  },
  urgent: {
    border: 'border-l-flag-red',
    chip: 'bg-flag-red text-white',
    label: 'Urgent',
  },
}

export function NoticeCard({ notice }: { notice: Notice }) {
  const style = severityStyles[notice.severity] ?? severityStyles.info

  return (
    <article
      className={`rounded-lg border border-asphalt-light border-l-4 bg-asphalt p-4 ${style.border}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold tracking-wide uppercase ${style.chip}`}
        >
          {style.label}
        </span>
        {notice.pinned && (
          <span className="rounded border border-flag-yellow px-2 py-0.5 text-xs font-semibold text-flag-yellow">
            Pinned
          </span>
        )}
        <time className="ml-auto text-xs text-zinc-500">{formatWhen(notice)}</time>
      </div>

      <h2 className="text-base font-bold text-zinc-100">{notice.title}</h2>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-zinc-300">
        {notice.body}
      </p>
    </article>
  )
}

function formatWhen(notice: Notice): string {
  // publishedAt is null between a local write and the server confirming it.
  if (!notice.publishedAt) return 'Sending…'
  return notice.publishedAt.toDate().toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
