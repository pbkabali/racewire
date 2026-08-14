import { useEvent } from './useEvent'

/**
 * Organiser contact details, in the footer of every event page.
 *
 * Rendered as `mailto:` and `tel:` links rather than plain text: on a phone —
 * which is most of the traffic, often trackside — tapping the number should
 * dial it, not select it.
 *
 * Nothing renders when the organiser has set neither. An empty "Contact"
 * heading is worse than no heading, and events created before these fields
 * existed have neither until someone edits them.
 */
export function EventContact() {
  const event = useEvent()
  const email = event.contactEmail?.trim()
  const phone = event.contactPhone?.trim()

  if (!email && !phone) return null

  return (
    <footer className="mt-8 border-t border-edge pt-4 text-sm">
      <h2 className="text-xs font-semibold tracking-wide text-fg-subtle uppercase">
        Contact the organiser
      </h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {email && (
          <a href={`mailto:${email}`} className="font-medium text-accent-text underline">
            {email}
          </a>
        )}
        {/* Spaces stripped from the href only: tel: tolerates them poorly, but
            the displayed number stays as the organiser grouped it. */}
        {phone && (
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            className="font-medium text-accent-text underline"
          >
            {phone}
          </a>
        )}
      </div>
    </footer>
  )
}
