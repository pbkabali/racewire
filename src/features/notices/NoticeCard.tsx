import { AttachmentList } from '../../components/attachments/AttachmentList'
import type { Notice, NoticeSeverity } from './types'

const severityStyles: Record<NoticeSeverity, { border: string; chip: string; label: string }> = {
  info: {
    border: 'border-l-edge',
    chip: 'bg-surface-raised text-fg',
    label: 'Info',
  },
  warning: {
    border: 'border-l-accent',
    chip: 'bg-accent text-accent-fg',
    label: 'Warning',
  },
  urgent: {
    border: 'border-l-danger',
    chip: 'bg-danger text-danger-fg',
    label: 'Urgent',
  },
}

export function NoticeCard({ notice }: { notice: Notice }) {
  const style = severityStyles[notice.severity] ?? severityStyles.info

  return (
    <article
      className={`rounded-lg border border-edge border-l-4 bg-surface p-4 ${style.border}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold tracking-wide uppercase ${style.chip}`}
        >
          {style.label}
        </span>
        {notice.pinned && (
          <span className="rounded border border-accent px-2 py-0.5 text-xs font-semibold text-accent-text">
            Pinned
          </span>
        )}
        <time className="ml-auto text-xs text-fg-subtle">
          {formatWhen(notice)}
          {notice.updatedAt && <span title="This notice was edited after publishing"> · edited</span>}
        </time>
      </div>

      <h2 className="text-base font-bold text-fg">{notice.title}</h2>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-fg">
        {notice.body}
      </p>

      <AttachmentList attachments={notice.attachments ?? []} />
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
