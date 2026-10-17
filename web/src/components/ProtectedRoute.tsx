import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { PageLoader } from './PageLoader';

export function ProtectedRoute({
  children,
  organizerOnly = false
}: {
  children: ReactNode;
  organizerOnly?: boolean;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader label="Checking your session" />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  if (organizerOnly && user.role !== 'organizer') return <Navigate to="/app" replace />;

  return <>{children}</>;
}
