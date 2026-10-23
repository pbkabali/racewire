import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { AuthProvider } from './app/providers/AuthProvider'
import { ThemeProvider } from './app/providers/ThemeProvider'
import { router } from './app/router'
import { PullToRefresh } from './components/PullToRefresh'
import { UpdateBanner } from './components/UpdateBanner'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {/* Outside the router: the refresh gesture must survive any page crash.
            The update prompt belongs here for the same reason, and more so --
            a crash caused by a chunk the last deploy replaced is exactly when
            somebody most needs to be offered the new version. */}
        <PullToRefresh />
        <UpdateBanner />
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
