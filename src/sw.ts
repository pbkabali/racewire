/// <reference lib="webworker" />
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'

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

const isFirebaseStorage = (url: URL) =>
  url.hostname === 'firebasestorage.googleapis.com' ||
  url.hostname.endsWith('.firebasestorage.app')

/*
 * Generated documents, which break the assumption the rule below rests on.
 *
 * The entry list is republished to the SAME path, keeping the SAME download
 * token, every time an entry changes -- deliberately, so that a link shared
 * last week still resolves. That makes it the one Storage object whose
 * contents change while its URL does not, and CacheFirst on a URL like that
 * serves whatever copy the device happened to fetch first, for thirty days.
 *
 * Which is precisely what it did: an installed PWA kept showing an entry list
 * from before the last three entries, while the same URL in a browser that
 * had never cached it was current.
 *
 * NetworkFirst instead: always current when there is signal, still readable in
 * a service park when there is none. The five-second timeout is what keeps
 * that promise on bad data rather than hanging on a stalled request.
 *
 * MUST stay in step with DOCUMENT_ID/FILE_NAME in
 * functions/src/entryList/publish.ts. Another generated document means another
 * name here, or it inherits the stale-forever behaviour silently.
 */
const GENERATED_DOCUMENTS = /entry-list\.pdf$/

registerRoute(
  ({ url }) => isFirebaseStorage(url) && GENERATED_DOCUMENTS.test(decodeURIComponent(url.pathname)),
  new NetworkFirst({
    cacheName: 'racewire-generated',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      // A handful of events' lists is plenty; this must not crowd out the
      // attachments cache, which is the one that matters offline.
      new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
)

/*
 * Attachments viewed once stay available offline.
 *
 * Firestore's persistence covers documents only -- it does nothing for Storage
 * downloads, so a course map would otherwise be unreachable exactly when the
 * app is still working from cache. CacheFirst because attachments are written
 * with an immutable Cache-Control and never change under a given URL -- which
 * holds for everything an organiser uploads, each landing at its own path, and
 * is why the generated route above has to be registered first.
 *
 * Bounded on purpose: 50 files / 30 days, and purgeOnQuotaError so the browser
 * evicting our quota degrades to a re-fetch rather than a broken cache.
 */
registerRoute(
  ({ url }) => isFirebaseStorage(url),
  new CacheFirst({
    cacheName: 'racewire-attachments',
    plugins: [
      // Storage returns opaque redirects for some requests; cache only real hits.
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

/*
 * Deliberately NOT skipWaiting() on install.
 *
 * Those two made a new worker seize an already-open page, and
 * cleanupOutdatedCaches() then deleted the precache that page was still
 * running from. The HTML and main bundle in memory reference chunk filenames
 * by content hash, so the next lazy import -- opening a PDF, the entry form,
 * any admin screen -- asked for a file that no longer existed in the cache or
 * on the server. It surfaced as "This browser cannot display the PDF", which
 * blamed the phone for a cache we had pulled out from under it.
 *
 * The usual companion to skipWaiting is reloading the page on
 * controllerchange. That is not safe here: the entry form holds its answers
 * in component state and only writes them on an explicit Save, so a reload
 * timed by our deploys would throw away a half-filled entry — passport
 * details, next of kin and all — at a moment of our choosing, not the
 * competitor's.
 *
 * So the new worker waits instead. The running page keeps the cache it was
 * loaded with and stays coherent; the update applies on the next cold start,
 * which for an installed app is the next launch. A spectator relaunching
 * still gets the newest board, which is what the previous behaviour was
 * reaching for — it simply no longer breaks the session already in progress
 * to do it.
 *
 * clients.claim() IS kept, and removing it alongside skipWaiting was a
 * mistake. skipWaiting was the dangerous half -- it activated a new worker
 * underneath a running page. claim only decides who controls a page once a
 * worker has already activated, which now happens either when every old
 * client is gone or when somebody taps Reload. Safe in both.
 *
 * Without it a first visit stays uncontrolled, so nothing is served from
 * cache until a second load -- and controllerchange never fires for that
 * page, which is what left the Reload button apparently doing nothing.
 */
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

/*
 * Let the page bring an update forward.
 *
 * The worker deliberately waits rather than seizing a running session, which
 * means an update otherwise lands only after the app is fully closed and
 * reopened -- two cold starts, and no way for anybody to know it is pending.
 * This is the other half: the page detects the waiting worker, offers a
 * Reload, and asks here only once somebody has tapped it.
 *
 * Asked for, never assumed. Automatic activation is what broke sessions
 * before, and the entry form holds its answers until an explicit Save.
 */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
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
