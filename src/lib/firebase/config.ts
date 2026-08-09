/**
 * Firebase configuration, read from Vite env vars.
 *
 * Copy `.env.example` to `.env.local` and fill in the values from
 * Firebase console -> Project settings -> Your apps -> Web app config.
 * `.env.local` is gitignored; never commit real values.
 *
 * Every key below is accessed statically. Vite inlines `import.meta.env.VITE_X`
 * by literal match at build time, so a computed lookup like
 * `import.meta.env[key]` compiles to `undefined` in production while still
 * working in dev -- do not refactor these into a loop.
 */
const raw = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const missing = Object.entries(raw)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missing.length) {
  // Fail loudly at startup rather than with an opaque Firebase error later.
  throw new Error(
    `Missing Firebase config: ${missing.join(', ')}. ` +
      'Copy .env.example to .env.local and fill in your Firebase web app config.',
  )
}

export const firebaseConfig = raw as { [K in keyof typeof raw]: string }

/** VAPID key for web push. Optional: in-browser notifications are simply disabled without it. */
export const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? ''

/** When true, connect to local emulators instead of live Firebase. */
export const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
