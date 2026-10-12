import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { de } from './i18n/de.ts'
import { FullPageMessage, RequireAuth } from './lib/auth.tsx'
import { AdminPage } from './routes/AdminPage.tsx'
import { InvitePage, LoginPage, ResetPage, SetupPage } from './routes/AuthPages.tsx'
import { DashboardPage } from './routes/DashboardPage.tsx'
import { SettingsPage } from './routes/SettingsPage.tsx'
import { SharePage } from './routes/SharePage.tsx'

// Excalidraw is large; load the editor route lazily (PLAN.md 5.13).
const BoardPage = lazy(() => import('./board/BoardPage.tsx'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/reset/:token" element={<ResetPage />} />
          <Route path="/share" element={<SharePage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/b/:boardId"
            element={
              <RequireAuth>
                <Suspense fallback={<FullPageMessage>{de.board.loading}</FullPageMessage>}>
                  <BoardPage />
                </Suspense>
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth admin>
                <AdminPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
