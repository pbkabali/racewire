/// <reference lib="webworker" />
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { firebaseConfig } from './lib/firebase/config'

declare const self: ServiceWorkerGlobalScope

/*
 * One service worker doing two jobs.
 *
 * FCM background messages must be handled in a worker registered at the app's
 * scope. A separate /firebase-messaging-sw.js would compete for that same scope
 * with the PWA worker and one would silently unregister the other, so both
 * responsibilities live here.
 */

// __WB_MANIFEST is replaced at build time with the precache manifest.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA fallback: any navigation that is not a precached file serves the app
// shell from cache, which is what makes deep links work with no connection.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/__/, /\/[^/?]+\.[^/]+$/],
  }),
)

// Take over immediately so a returning spectator gets the newest board rather
// than whatever was cached when they last had signal.
self.skipWaiting()
self.addEventListener('activate', () => self.clients.claim())

const messaging = getMessaging(initializeApp(firebaseConfig))

onBackgroundMessage(messaging, (payload) => {
  const { title, body } = payload.notification ?? {}
  if (!title) return

  void self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Collapse repeats of the same notice instead of stacking them.
    tag: payload.data?.noticeId ?? 'racewire',
    data: payload.data,
  })
})

// Focus an open tab if there is one; otherwise open the board.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.path ?? '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client)
      if (existing) return existing.focus()
      return self.clients.openWindow(target)
    }),
  )
})
