import { lazy } from 'react'

/*
 * Admin screens are split out of the entry bundle: spectators are the
 * overwhelming majority of traffic and never sign in, so they should not pay
 * for the admin UI on first load.
 */
export const LoginPage = lazy(() =>
  import('../features/admin/LoginPage').then((m) => ({ default: m.LoginPage })),
)

export const AdminEventList = lazy(() =>
  import('../features/admin/AdminEventList').then((m) => ({ default: m.AdminEventList })),
)

export const AdminEventDashboard = lazy(() =>
  import('../features/admin/AdminEventDashboard').then((m) => ({
    default: m.AdminEventDashboard,
  })),
)
