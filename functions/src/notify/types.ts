/** Delivery channels a notice can go out on. */
export type Channel = 'push' | 'sms' | 'whatsapp'

export type OutboundMessage = {
  /** Channel-specific address: an FCM token, or an E.164 phone number. */
  to: string
  title: string
  body: string
  /** Extra key/values delivered alongside a push payload. */
  data?: Record<string, string>
}

export type SendResult = {
  channel: Channel
  to: string
  ok: boolean
  /** Provider message id when the send succeeded. */
  id?: string
  error?: string
}

/**
 * Contract every channel implements.
 *
 * Keeping this narrow is what lets WhatsApp and SMS be swapped for a different
 * vendor later without touching dispatch or the callers.
 */
export type NotificationProvider = {
  channel: Channel
  /** False when the provider has no credentials configured; dispatch skips it. */
  isConfigured(): boolean
  send(message: OutboundMessage): Promise<SendResult>
}
