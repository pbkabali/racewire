import { getMessaging } from 'firebase-admin/messaging'

import type { NotificationProvider, OutboundMessage, SendResult } from '../types.js'

/**
 * In-browser / installed-PWA push via Firebase Cloud Messaging.
 *
 * Always configured: FCM uses the same project credentials the function already
 * runs with, so there is nothing extra to set up.
 */
export const fcmProvider: NotificationProvider = {
  channel: 'push',

  isConfigured: () => true,

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const id = await getMessaging().send({
        token: message.to,
        notification: { title: message.title, body: message.body },
        data: message.data,
        webpush: {
          fcmOptions: { link: message.data?.path ?? '/' },
          notification: {
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
          },
        },
        android: { priority: 'high' },
      })
      return { channel: 'push', to: message.to, ok: true, id }
    } catch (cause) {
      return {
        channel: 'push',
        to: message.to,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    }
  },
}

/**
 * FCM error codes that mean the token is permanently dead -- the user cleared
 * site data, uninstalled the PWA, or the token was rotated. Callers should
 * delete these subscribers rather than retrying forever.
 */
export const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])
