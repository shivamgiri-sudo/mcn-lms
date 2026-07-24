import { Routes, Route, Navigate } from 'react-router-dom';
import TraineePage from './pages/Trainee/TraineePage.jsx';
import CoordinatorPage from './pages/Coordinator/CoordinatorPage.jsx';
import AdminPage from './pages/Admin/AdminPage.jsx';
import ManagementPage from './pages/Management/ManagementPage.jsx';
import PasswordResetPage from './pages/Auth/PasswordResetPage.jsx';
import { runSsoBootstrap } from './utils/ssoBootstrap.js';

export default function App() {
  runSsoBootstrap();
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lms" replace />} />
      <Route path="/reset-password" element={<PasswordResetPage />} />
      <Route path="/lms/*" element={<TraineePage />} />
      <Route path="/coordinator/*" element={<CoordinatorPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="/management/*" element={<ManagementPage />} />
    </Routes>
  );
}
