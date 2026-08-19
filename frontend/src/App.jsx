import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Login from "./pages/Login";
import TenantSelector from "./pages/TenantSelector";
import AppLayout from "./components/layout/AppLayout";
import TenantsAdmin from "./pages/Admin/TenantsAdmin";
import TenantUsers from "./pages/Admin/TenantUsers";
import Register from "./pages/Register";

function ProtectedRoute({ children }) {
  const { status } = useAuth();

  if (status === "checking") {
    return <div className="full-screen-loader">Chargement…</div>;
  }
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} /> 
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <TenantSelector />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/tenants"
        element={
          <ProtectedRoute>
            <TenantsAdmin />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/tenants/:tenantId/users"
        element={
          <ProtectedRoute>
            <TenantUsers />
          </ProtectedRoute>
        }
      />

      <Route
        path="/:tenantSlug/*"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}