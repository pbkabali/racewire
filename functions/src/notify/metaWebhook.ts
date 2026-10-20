import { createHmac, timingSafeEqual } from 'node:crypto'

export type StatusUpdate = { id: string; status: string; reason?: string }

/**
 * Is this payload really from Meta?
 *
 * HMAC-SHA256 of the raw body against the app secret, compared without
 * leaking timing. The RAW body matters: re-serialising the parsed JSON would
 * change whitespace and key order and never match.
 *
 * This is the only thing standing between the endpoint and anyone on the
 * internet marking a message delivered -- which would suppress the SMS to a
 * competitor who never received the WhatsApp. It fails closed everywhere.
 */
export function isFromMeta(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !rawBody || !header?.startsWith('sha256=')) return false

  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'))
  const given = Buffer.from(header.slice('sha256='.length))

  // timingSafeEqual throws on a length mismatch rather than returning false.
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * Dig the statuses out of Meta's deeply nested envelope.
 *
 * Defensive at every level rather than trusting the documented shape: this
 * parses attacker-reachable input (the signature is checked first, but a
 * malformed payload from Meta itself would be just as good at crashing it),
 * and a throw here would be retried by Meta forever.
 */
export function extractStatuses(body: unknown): StatusUpdate[] {
  const entries = (body as { entry?: unknown[] } | null)?.entry
  if (!Array.isArray(entries)) return []

  const updates: StatusUpdate[] = []

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes
    if (!Array.isArray(changes)) continue

    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown[] } }).value?.statuses
      if (!Array.isArray(statuses)) continue

      for (const status of statuses) {
        const row = status as {
          id?: string
          status?: string
          errors?: { title?: string; message?: string }[]
        }
        if (!row.id || !row.status) continue
        const error = row.errors?.[0]
        updates.push({ id: row.id, status: row.status, reason: error?.message ?? error?.title })
      }
    }
  }

  return updates
}
