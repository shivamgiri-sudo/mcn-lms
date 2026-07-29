import { Routes, Route, Navigate } from 'react-router-dom';
import TraineePage from './pages/Trainee/TraineePage.jsx';
import CoordinatorPage from './pages/Coordinator/CoordinatorPage.jsx';
import AdminPage from './pages/Admin/AdminPage.jsx';
import ManagementPage from './pages/Management/ManagementPage.jsx';
import PasswordResetPage from './pages/Auth/PasswordResetPage.jsx';
import DevelopmentHubRoute from './pages/Development/DevelopmentHubRoute.jsx';
import TrainingCalendarPage from './pages/TrainingCalendar/TrainingCalendarPage.jsx';
import PracticalAssessmentsPage from './pages/PracticalAssessments/PracticalAssessmentsPage.jsx';
import EvaluatorQualityPage from './pages/EvaluatorQuality/EvaluatorQualityPage.jsx';
import AssessmentIntelligencePage from './pages/AssessmentIntelligence/AssessmentIntelligencePage.jsx';
import SessionSecurityPage from './pages/SessionSecurity/SessionSecurityPage.jsx';
import NotificationDock from './pages/Notifications/NotificationDock.jsx';
import LearningToolsDock from './components/LearningToolsDock.jsx';
import { runSsoBootstrap } from './utils/ssoBootstrap.js';

export default function App() {
  runSsoBootstrap();
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/lms" replace />} />
        <Route path="/reset-password" element={<PasswordResetPage />} />
        <Route path="/development-hub" element={<DevelopmentHubRoute />} />
        <Route path="/training-calendar" element={<TrainingCalendarPage />} />
        <Route path="/practical-assessments" element={<PracticalAssessmentsPage />} />
        <Route path="/evaluator-quality" element={<EvaluatorQualityPage />} />
        <Route path="/assessment-intelligence" element={<AssessmentIntelligencePage />} />
        <Route path="/session-security" element={<SessionSecurityPage />} />
        <Route path="/lms/*" element={<TraineePage />} />
        <Route path="/coordinator/*" element={<CoordinatorPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/management/*" element={<ManagementPage />} />
      </Routes>
      <LearningToolsDock />
      <NotificationDock />
    </>
  );
}
