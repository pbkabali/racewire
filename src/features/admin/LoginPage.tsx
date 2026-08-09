import { FirebaseError } from 'firebase/app'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../app/providers/useAuth'
import { signIn } from '../../lib/firebase/auth'

export function LoginPage() {
  const { user, admin, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Already signed in as an admin: skip the form.
  if (!loading && user && admin) {
    const from = (location.state as { from?: string } | null)?.from ?? '/admin'
    return <Navigate to={from} replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate((location.state as { from?: string } | null)?.from ?? '/admin', { replace: true })
    } catch (cause) {
      setError(describeAuthError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-track-black px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-asphalt-light bg-asphalt p-6"
      >
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Organiser sign in</h1>
          <p className="mt-1 text-sm text-zinc-500">Admin access only.</p>
        </div>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Email
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-asphalt-light bg-track-black px-3 py-2 text-zinc-100"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Password
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-asphalt-light bg-track-black px-3 py-2 text-zinc-100"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-flag-red">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-flag-yellow py-2 font-bold text-track-black disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

/** Firebase auth errors are codes; surface something a human can act on. */
function describeAuthError(cause: unknown): string {
  if (cause instanceof FirebaseError) {
    switch (cause.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again shortly.'
      case 'auth/network-request-failed':
        return 'No connection. Sign-in needs internet, unlike the rest of the app.'
      default:
        return cause.message
    }
  }
  return 'Something went wrong. Try again.'
}
