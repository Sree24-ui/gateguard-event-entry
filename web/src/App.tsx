import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { UpdatePrompt } from './components/UpdatePrompt';
import { LandingPage } from './pages/LandingPage';
import { SignInPage } from './pages/SignInPage';
import { SignUpPage } from './pages/SignUpPage';
import { DashboardPage } from './pages/DashboardPage';
import { EventFormPage } from './pages/EventFormPage';
import { EventDetailPage } from './pages/EventDetailPage';
import { ScanPickPage } from './pages/ScanPickPage';
import { TeamPage } from './pages/TeamPage';
import { ActivityPage } from './pages/ActivityPage';
import { TicketPage } from './pages/TicketPage';
import { PublicRegisterPage } from './pages/PublicRegisterPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { AdminPage } from './pages/AdminPage';
import { PageLoader } from './components/PageLoader';

// The QR decoder is ~600kB and only the scanner needs it, so it stays out of
// the bundle every other visitor downloads.
const ScannerPage = lazy(() =>
  import('./features/scanner/ScannerPage').then((module) => ({ default: module.ScannerPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A failed request offline should surface, not spin behind three retries.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error as { offline?: boolean })?.offline,
      refetchOnWindowFocus: true,
      staleTime: 3000
    }
  }
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/signin" element={<SignInPage />} />
                <Route path="/signup" element={<SignUpPage />} />
                <Route path="/e/:eventId" element={<PublicRegisterPage />} />
                <Route path="/t/:code" element={<TicketPage />} />
                <Route path="/my" element={<MyTicketsPage />} />

                <Route
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/app" element={<DashboardPage />} />
                  <Route path="/app/events/new" element={<EventFormPage />} />
                  <Route path="/app/events/:eventId" element={<EventDetailPage />} />
                  <Route path="/app/events/:eventId/edit" element={<EventFormPage />} />
                  <Route path="/app/scan" element={<ScanPickPage />} />
                  <Route
                    path="/app/scan/:eventId"
                    element={
                      <Suspense fallback={<PageLoader label="Loading the scanner" />}>
                        <ScannerPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/app/team"
                    element={
                      <ProtectedRoute roles={['organizer']}>
                        <TeamPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/app/admin"
                    element={
                      <ProtectedRoute roles={['admin']}>
                        <AdminPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/app/activity"
                    element={
                      <ProtectedRoute roles={['organizer', 'admin']}>
                        <ActivityPage />
                      </ProtectedRoute>
                    }
                  />
                </Route>

                <Route path="/dashboard" element={<Navigate to="/app" replace />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              <UpdatePrompt />
            </ErrorBoundary>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
