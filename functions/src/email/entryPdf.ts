import { getStorage } from 'firebase-admin/storage'
import { logger } from 'firebase-functions'

import type { EmailAttachment } from './providers.js'

/**
 * Fetch the generated entry PDF, ready to attach.
 *
 * Loaded once per submission and shared by both emails that go out. Each
 * downloading its own copy would double the egress and, worse, let the entrant
 * and the organiser end up with different attachments if one download failed.
 *
 * Returns null rather than throwing: an entry that arrived without its PDF is
 * still an entry, and both messages are worth more than the attachment. The
 * organiser can always download it from the admin screen.
 */
export async function loadEntryPdf(
  pdfPath: string | null,
  licenceNumber: string,
): Promise<EmailAttachment | null> {
  if (!pdfPath) return null

  try {
    const [buffer] = await getStorage().bucket().file(pdfPath).download()
    return {
      content: buffer.toString('base64'),
      filename: `entry-${licenceNumber || 'form'}.pdf`,
      contentType: 'application/pdf',
    }
  } catch (cause) {
    logger.error('could not attach entry PDF', { path: pdfPath, cause })
    return null
  }
}
