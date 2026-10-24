/**
 * The embeddable form of a Google My Maps link, or null.
 *
 * Organisers paste whatever the address bar held, which is usually a
 * `/maps/d/viewer?mid=…` link, sometimes `/maps/d/edit?…` copied straight out
 * of the editor, sometimes already an embed. All of them carry the same `mid`,
 * so the map id is the only part worth reading and the rest is rebuilt.
 *
 * Returning null is a real answer, not a failure: a shortened maps.app.goo.gl
 * link or an ordinary Google Maps pin has no mid and cannot be embedded. The
 * caller falls back to offering the link rather than a broken frame.
 *
 * It is also the security boundary. This only ever returns a URL it
 * constructed on google.com/maps/d/embed, so a pasted address can never put
 * an arbitrary site inside the app's own chrome — which, in a frame people
 * will read as part of the event, is worth more than the convenience of
 * accepting anything.
 */
export function toMyMapsEmbedUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (url.hostname !== 'www.google.com' && url.hostname !== 'google.com') return null
  if (!url.pathname.includes('/maps/d/')) return null

  const mid = url.searchParams.get('mid')
  if (!mid) return null

  return `https://www.google.com/maps/d/embed?mid=${encodeURIComponent(mid)}`
}
