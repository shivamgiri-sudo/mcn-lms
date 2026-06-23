import { Routes, Route, Navigate } from 'react-router-dom';
import TraineePage from './pages/Trainee/TraineePage.jsx';
import CoordinatorPage from './pages/Coordinator/CoordinatorPage.jsx';
import AdminPage from './pages/Admin/AdminPage.jsx';
import ManagementPage from './pages/Management/ManagementPage.jsx';
import { runSsoBootstrap } from './utils/ssoBootstrap.js';

export default function App() {
  runSsoBootstrap(); // must run before routes render — handles HRMS2 token handoff
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lms" replace />} />
      <Route path="/lms/*" element={<TraineePage />} />
      <Route path="/coordinator/*" element={<CoordinatorPage />} />
      <Route path="/admin/*" element={<AdminPage />} />
      <Route path="/management/*" element={<ManagementPage />} />
    </Routes>
  );
}
