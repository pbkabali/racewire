import { Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { Loading } from '../components/Loading'
import { AppShell } from '../components/layout/AppShell'
import { AlertsPage } from '../features/alerts/AlertsPage'
import { NoticesPage } from '../features/notices/NoticesPage'
import { SchedulePage } from '../features/races/SchedulePage'
import { AdminDashboard, LoginPage } from './lazyPages'
import { ProtectedRoute } from './ProtectedRoute'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <NoticesPage /> },
      { path: '/schedule', element: <SchedulePage /> },
      { path: '/alerts', element: <AlertsPage /> },
    ],
  },
  {
    path: '/admin/login',
    element: (
      <Suspense fallback={<Loading />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/admin',
        element: (
          <Suspense fallback={<Loading />}>
            <AdminDashboard />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: '*',
    element: (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-bg">
        <p className="text-3xl font-bold text-accent-text">404</p>
        <p className="text-sm text-fg-muted">That page does not exist.</p>
      </div>
    ),
  },
])
