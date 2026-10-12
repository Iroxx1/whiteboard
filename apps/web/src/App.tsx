import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { HomePage } from './routes/HomePage.tsx'
import { SharePage } from './routes/SharePage.tsx'

// Excalidraw is large; load the editor route lazily (PLAN.md 5.13).
const ExcalidrawSpike = lazy(() => import('./spike/ExcalidrawSpike.tsx'))

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/share" element={<SharePage />} />
        <Route
          path="/spike/excalidraw"
          element={
            <Suspense fallback={<div className="p-6 text-[var(--wb-muted)]">…</div>}>
              <ExcalidrawSpike />
            </Suspense>
          }
        />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  )
}
