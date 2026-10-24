import { useEvent } from '../events/useEvent'
import { toMyMapsEmbedUrl } from './myMaps'

/**
 * The route map, as the organiser maintains it.
 *
 * Embedded live rather than exported, because the point is that it is
 * current: a PDF of the route is out of date the moment a stage moves, and
 * nobody re-exports it at 23:00 the night before. Edits in My Maps appear
 * here with no republishing.
 *
 * The Open button matters as much as the map. A crew looking for a service
 * park wants turn-by-turn in the app they already use, which an embedded
 * frame cannot give them.
 */
export function MapPage() {
  const event = useEvent()
  const embed = toMyMapsEmbedUrl(event.mapUrl)

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold tracking-tight text-fg">Route map</h1>

      {!event.mapUrl && (
        <p className="rounded-lg border border-edge bg-surface p-6 text-center text-sm text-fg-muted">
          No route map has been published yet.
        </p>
      )}

      {event.mapUrl && (
        <>
          {embed ? (
            <div className="overflow-hidden rounded-lg border border-edge bg-surface">
              <iframe
                src={embed}
                title={`${event.name} route map`}
                loading="lazy"
                className="h-[60vh] min-h-80 w-full border-0"
                allowFullScreen
              />
            </div>
          ) : (
            /* A shortened link or an ordinary Maps pin carries no map id, so
               there is nothing to embed. Saying so beats an empty frame. */
            <p className="rounded-lg border border-edge bg-surface p-4 text-sm text-fg-muted">
              This map can only be opened in Google Maps.
            </p>
          )}

          <a
            href={event.mapUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-fg"
          >
            Open in Google Maps
          </a>

          {/* Said plainly rather than discovered on a stage with no signal.
              The offline copy is a document, and belongs in the library. */}
          <p className="text-xs text-fg-subtle">
            The live map needs a data connection. Download the route PDF from Documents
            before you lose signal.
          </p>
        </>
      )}
    </div>
  )
}
