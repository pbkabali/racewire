import { lazy } from 'react'

/**
 * Admin screens, split out of the main bundle.
 *
 * Most visitors are spectators who will never open these, and keeping them out
 * of the entry chunk shortens first paint on race-day mobile data. They live in
 * their own module so router.tsx exports only the route config.
 */
export const LoginPage = lazy(() =>
  import('../features/admin/LoginPage').then((m) => ({ default: m.LoginPage })),
)

export const AdminDashboard = lazy(() =>
  import('../features/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })),
)
