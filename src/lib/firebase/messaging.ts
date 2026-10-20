import { arrayUnion, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging'

import { firebaseApp } from './app'
import { vapidKey } from './config'
import { collections, db } from './db'

let messagingPromise: Promise<Messaging | null> | null = null

/**
 * Resolve FCM lazily, and to `null` where it cannot run.
 *
 * Web push is unavailable in a number of situations we actually expect on a
 * mobile-first race app -- iOS Safari unless the PWA is installed to the home
 * screen, private browsing, and any non-HTTPS origin -- so every caller has to
 * handle absence. SMS and WhatsApp are the fallback channels for those users.
 */
export function getMessagingIfSupported(): Promise<Messaging | null> {
  messagingPromise ??= isSupported().then((supported) =>
    supported && vapidKey ? getMessaging(firebaseApp) : null,
  )
  return messagingPromise
}

/**
 * Ask for notification permission and register this device for push.
 *
 * Returns the FCM token, or null if unsupported or the user declined.
 * Call this from a user gesture -- browsers reject permission prompts that
 * fire on page load.
 *
 * Scoped to an event. The token still belongs to the device, so it stays
 * keyed by token in a single global collection, but it carries the set of
 * events the device has subscribed to -- one phone following two rallies is
 * ordinary, and dispatch reads this to avoid telling everybody about an event
 * they are not at. arrayUnion rather than a fresh array so subscribing to a
 * second event does not unsubscribe from the first.
 */
export async function registerForPush(eventCode: string): Promise<string | null> {
  const messaging = await getMessagingIfSupported()
  if (!messaging) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const registration = await navigator.serviceWorker.ready
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  })
  if (!token) return null

  // Keyed by token so re-registering the same device is idempotent.
  await setDoc(
    doc(db, collections.subscribers, token),
    {
      token,
      channel: 'push',
      events: arrayUnion(eventCode.toUpperCase()),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )

  return token
}

/** Foreground push handler. Background messages are handled by the service worker. */
export async function onForegroundMessage(
  handler: (payload: MessagePayload) => void,
): Promise<() => void> {
  const messaging = await getMessagingIfSupported()
  if (!messaging) return () => {}
  return onMessage(messaging, handler)
}
