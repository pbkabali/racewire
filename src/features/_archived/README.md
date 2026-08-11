# Archived features

Not routed, not in the navigation, and not built into the bundle — nothing
imports them. Kept because the work is done and the decision to shelve them was
about product timing, not quality.

## alerts/

The in-browser notification opt-in screen. Removed from the nav when Docs and
Results took its place; parked for reconsideration rather than deleted.

Still live and still used elsewhere, so this page can be re-routed without any
rebuild:

- `src/lib/firebase/messaging.ts` — FCM token registration and foreground handler
- `functions/src/notify/` — dispatch and the FCM/WhatsApp/SMS providers
- `subscribers` collection — device push tokens
- `src/sw.ts` — background push handler

**To bring it back:** move the folder out of `_archived/`, add a route in
`src/app/router.tsx`, and add an entry to `navItems` in
`src/components/layout/AppShell.tsx`. It will need scoping to an event first —
it predates the multi-event model and assumes a single global board.
