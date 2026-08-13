import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useAuth } from '../../app/providers/useAuth'
import { auth } from '../../lib/firebase/auth'
import { isAnyAdmin } from '../../lib/firebase/auth'

/**
 * Verify a phone number by SMS, using Firebase Phone Auth.
 *
 * Works identically on desktop: the number is typed in the browser, the code
 * arrives on the phone, and it is typed back. Only Android Chrome's SMS
 * autofill is mobile-specific, and its absence just means typing six digits.
 *
 * Firebase sends and checks the code itself, so there is no OTP to store, no
 * expiry to manage and no rate limiting to write — all of which are easy to get
 * subtly wrong. The verified session is also what secures the draft: rules can
 * then say "only this uid may read its own entry".
 */
export function PhoneVerification({
  onVerified,
}: {
  onVerified: (phone: string, uid: string) => void
}) {
  const { user, scope } = useAuth()

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** True once the checkbox is ticked; Send stays disabled until it is. */
  const [solved, setSolved] = useState(false)

  const recaptchaRef = useRef<HTMLDivElement>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)

  /**
   * Build a verifier, tearing down anything left from a previous attempt.
   *
   * `clear()` alone is not enough: it releases Firebase's handle but leaves the
   * widget's markup in the container, so the next attempt fails with "reCAPTCHA
   * has already been rendered in this element". One failed send would otherwise
   * poison every retry until a full page reload. Emptying the node is what
   * actually makes it reusable.
   */
  function freshVerifier(): RecaptchaVerifier {
    verifierRef.current?.clear()
    verifierRef.current = null
    if (recaptchaRef.current) recaptchaRef.current.innerHTML = ''

    /*
     * A visible checkbox, not the invisible variant.
     *
     * Invisible reCAPTCHA scores the session silently and, when it is not
     * satisfied, fails with auth/invalid-app-credential and no way for the user
     * to do anything about it. That happened here in both Brave and Chrome
     * while the project itself was correctly configured -- verified: the API
     * key reaches Identity Toolkit, localhost is authorized, phone sign-in is
     * enabled and UG is allowed.
     *
     * The checkbox costs one tap and either passes or shows a challenge the
     * person can actually complete. A reliable tap beats an invisible check
     * that strands people.
     */
    setSolved(false)
    verifierRef.current = new RecaptchaVerifier(auth, recaptchaRef.current!, {
      size: 'normal',
      theme: 'dark',
      callback: () => setSolved(true),
      // A solved challenge expires after a couple of minutes; re-disable rather
      // than let a stale tick send a request that will be refused.
      'expired-callback': () => setSolved(false),
    })
    return verifierRef.current
  }

  useEffect(() => {
    // Rendered on mount so the person can solve it while typing their number,
    // rather than the widget appearing at the instant they press Send.
    if (!confirmation) {
      try {
        void freshVerifier().render()
      } catch {
        // A second render in React StrictMode's double-invoke is harmless.
      }
    }

    return () => {
      verifierRef.current?.clear()
      verifierRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const trimmed = phone.trim()
    if (!trimmed.startsWith('+')) {
      setError('Include the country code, starting with + — for example +256700000000.')
      return
    }

    setBusy(true)
    try {
      const verifier = verifierRef.current ?? freshVerifier()
      const result = await signInWithPhoneNumber(auth, trimmed, verifier)
      setConfirmation(result)
    } catch (cause) {
      // The friendly message loses the detail that identifies the cause, so the
      // raw error goes to the console where it can be read and reported.
      console.error('[racewire] phone verification failed', {
        code: (cause as { code?: string })?.code,
        message: (cause as { message?: string })?.message,
        cause,
      })
      setError(describe(cause))
      // A consumed or rejected challenge cannot be reused; give them a new one.
      try {
        void freshVerifier().render()
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault()
    if (!confirmation) return

    setError(null)
    setBusy(true)
    try {
      const credential = await confirmation.confirm(code.trim())
      onVerified(credential.user.phoneNumber ?? phone.trim(), credential.user.uid)
    } catch (cause) {
      setError(describe(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={confirmation ? confirmCode : sendCode}
      className="space-y-3 rounded-lg border border-edge bg-surface p-4"
    >
      <div>
        <h2 className="font-semibold text-fg">Verify your phone</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          We send a one-time code by SMS. It ties the entry to a real contact and
          lets you come back to a part-finished form.
        </p>
      </div>

      {/* Signing in by phone replaces whatever session exists, so an admin
          trying the form would be signed out of the admin area. Worth saying
          before it happens rather than leaving them confused afterwards. */}
      {user && isAnyAdmin(scope) && (
        <p className="rounded border border-danger bg-surface-raised p-2 text-xs text-danger-text">
          You are signed in as an admin. Verifying a phone number here will sign
          you out of the admin area — you will need to sign back in at /admin/login.
        </p>
      )}

      {!confirmation ? (
        <>
          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Mobile number
            </span>
            <input
              required
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+256700000000"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-fg placeholder:text-fg-subtle"
            />
            <span className="mt-1 block text-xs text-fg-subtle">
              Include the country code.
            </span>
          </label>

          <div>
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Confirm you are not a robot
            </span>
            {/* Above the button, because it has to be done first. Below it, the
                enabled button read as the next step and the checkbox as
                decoration. */}
            <div ref={recaptchaRef} className="mt-1" />
          </div>

          <button
            type="submit"
            disabled={busy || !solved}
            className="w-full rounded-md bg-accent py-2 font-bold text-accent-fg disabled:opacity-60"
          >
            {busy ? 'Sending…' : solved ? 'Send code' : 'Tick the box above first'}
          </button>
        </>
      ) : (
        <>
          <label className="block">
            <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
              Six-digit code
            </span>
            <input
              required
              autoFocus
              // one-time-code lets iOS and Android offer the SMS automatically.
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="mt-1 w-full rounded-md border border-edge bg-bg px-3 py-2 text-center font-mono text-lg tracking-widest text-fg placeholder:text-fg-subtle"
            />
            <span className="mt-1 block text-xs text-fg-subtle">
              Sent to {phone}.
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-accent py-2 font-bold text-accent-fg disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Verify'}
          </button>

          <button
            type="button"
            onClick={() => {
              setConfirmation(null)
              setCode('')
              setError(null)
            }}
            className="w-full text-xs font-semibold text-fg-muted hover:text-fg"
          >
            Use a different number
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}


    </form>
  )
}

function describe(cause: unknown): string {
  const code = (cause as { code?: string })?.code ?? ''

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'That does not look like a valid number. Include the country code, e.g. +256700000000.'
    case 'auth/invalid-verification-code':
      return 'That code is not right. Check the SMS and try again.'
    case 'auth/code-expired':
      return 'That code has expired. Request a new one.'
    case 'auth/too-many-requests':
      return 'Too many attempts from this device. Wait a few minutes and try again.'
    case 'auth/quota-exceeded':
      return 'The SMS quota for this project has been reached. Contact the organiser.'
    case 'auth/operation-not-allowed':
      return (
        'Phone sign-in is not enabled for this project. If it was just switched ' +
        'on, give it a minute and reload the page — the setting is read when the ' +
        'page loads.'
      )
    case 'auth/captcha-check-failed':
      return 'The security check failed. Reload the page and try again.'
    case 'auth/invalid-app-credential':
      /*
       * The reCAPTCHA token was rejected. In practice this is almost always the
       * browser blocking Google's reCAPTCHA scripts -- Brave Shields, uBlock,
       * strict tracking protection -- rather than anything wrong with the
       * project. It does not show up while testing with a Firebase test phone
       * number, because those skip app verification entirely.
       */
      return (
        'The security check could not complete. This is usually a browser ' +
        'blocking Google’s reCAPTCHA: turn off Shields or your ad blocker for ' +
        'this site, or try another browser, then reload.'
      )
    default:
      return cause instanceof Error ? cause.message : 'Could not send the code.'
  }
}
