import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="num text-sm text-slate1">Checking your session…</p>
      </div>
    );

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}
