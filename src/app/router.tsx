import { Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'

import { ErrorScreen } from '../components/ErrorScreen'
import { Loading } from '../components/Loading'
import { DocumentsPage } from '../features/documents/DocumentsPage'
import { EventLayout } from '../features/events/EventLayout'
import { EventPickerPage } from '../features/events/EventPickerPage'
import { NoticesPage } from '../features/notices/NoticesPage'
import { SchedulePage } from '../features/races/SchedulePage'
import { ResultsPage } from '../features/results/ResultsPage'
import {
  AdminEventDashboard,
  AdminEventList,
  FillFormPage,
  LoginPage,
} from './lazyPages'
import { ProtectedRoute } from './ProtectedRoute'

const lazy = (element: React.ReactNode) => (
  <Suspense fallback={<Loading />}>{element}</Suspense>
)

export const router = createBrowserRouter([
  {
    /*
     * Pathless, and rendering nothing itself: this route exists only to hang
     * the error screen above every other route, so a crash anywhere in the
     * tree lands on something a person can leave rather than react-router's
     * developer-facing default.
     */
    errorElement: <ErrorScreen />,
    children: [
      // Landing: pick an event. Everything public hangs off /e/:code.
      { path: '/', element: <EventPickerPage /> },

      {
        // The /e/ prefix permanently reserves the root namespace, so an event
        // code can never collide with /admin or any future top-level route.
        path: '/e/:code',
        element: <EventLayout />,
        children: [
          { index: true, element: <NoticesPage /> },
          { path: 'schedule', element: <SchedulePage /> },
          { path: 'docs', element: <DocumentsPage /> },
          { path: 'docs/fill/:documentId', element: lazy(<FillFormPage />) },
          { path: 'results', element: <ResultsPage /> },
        ],
      },

      { path: '/admin/login', element: lazy(<LoginPage />) },

      {
        element: <ProtectedRoute />,
        children: [
          { path: '/admin', element: lazy(<AdminEventList />) },
          { path: '/admin/e/:code', element: lazy(<AdminEventDashboard />) },
        ],
      },

      {
        path: '*',
        element: (
          <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-bg px-6 text-center">
            <p className="text-3xl font-bold text-accent-text">404</p>
            <p className="text-sm text-fg-muted">That page does not exist.</p>
            <a href="/" className="mt-2 text-sm font-semibold text-accent-text underline">
              Choose an event
            </a>
          </div>
        ),
      },
    ],
  },
])
