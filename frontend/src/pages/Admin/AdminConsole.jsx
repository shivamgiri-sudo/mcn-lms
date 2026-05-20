import { useState } from 'react';
import { api } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import CurriculumTab from './CurriculumTab.jsx';
import AccountsTab from './AccountsTab.jsx';
import QuestionsTab from './QuestionsTab.jsx';
import CertRulesTab from './CertRulesTab.jsx';
import DriveTab from './DriveTab.jsx';
import DashboardPage from './DashboardPage.jsx';
import BatchesPage from './BatchesPage.jsx';
import BatchDetailPage from './BatchDetailPage.jsx';
import BatchCreationWizard from './BatchCreationWizard.jsx';
import CoordinatorsPage from './CoordinatorsPage.jsx';
import CoordDetailPage from './CoordDetailPage.jsx';
import TraineeDetailPage from './TraineeDetailPage.jsx';
import RiskDrilldownPage from './RiskDrilldownPage.jsx';
import ProcessLobTab from './ProcessLobTab.jsx';
import ReportsTab from './ReportsTab.jsx';
import BranchTab from './BranchTab.jsx';
import UsersTab from './UsersTab.jsx';
import OrgTab from './OrgTab.jsx';
import BroadcastTab from './BroadcastTab.jsx';
import EmpIdMappingUpload from './EmpIdMappingUpload.jsx';

const NAV = [
  { section: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: '📊' }] },
  { section: 'Training', items: [
    { id: 'curriculum', label: 'Curriculum', icon: '📋' },
    { id: 'questions', label: 'Questions & MCQ', icon: '❓' },
    { id: 'broadcast', label: 'Broadcast / Assign', icon: '📢' },
    { id: 'drive', label: 'Drive Sync', icon: '☁️' },
  ]},
  { section: 'People', items: [
    { id: 'batches', label: 'Batches', icon: '🏢' },
    { id: 'branches', label: 'Branches', icon: '🌿' },
    { id: 'accounts', label: 'Trainee Accounts', icon: '👤' },
    { id: 'emp-mapping', label: 'Map Perm. Emp IDs', icon: '🔗' },
    { id: 'coordinators', label: 'Coordinators', icon: '🧑‍💼' },
    { id: 'users', label: 'Portal Users', icon: '🔑' },
  ]},
  { section: 'Reports', items: [
    { id: 'reports', label: 'Reports & Exports', icon: '📥' },
  ]},
  { section: 'Config', items: [
    { id: 'processlob', label: 'Process & LOB', icon: '⚙️' },
    { id: 'certrules', label: 'Cert Rules', icon: '🎓' },
    { id: 'org', label: 'Organization', icon: '🏢' },
  ]},
];

export default function AdminConsole({ user, onLogout }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [page, setPage] = useState({ id: 'dashboard' });
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ password: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwForm.password.length < 6) return setPwMsg('Password must be at least 6 characters.');
    if (pwForm.password !== pwForm.confirm) return setPwMsg('Passwords do not match.');
    const res = await api.post('/admin/reset-password', { password: pwForm.password }, 'admin');
    if (res.ok) { setShowPwModal(false); setPwForm({ password: '', confirm: '' }); setPwMsg(''); }
    else setPwMsg(res.message || 'Failed to update password.');
  }

  function navigate(id, context) {
    setPage({ id, context });
  }

  const activeId = page.id;

  function getBreadcrumb() {
    if (activeId === 'batch-detail') return [{ label: 'Batches', onClick: () => navigate('batches') }, { label: page.context?.batchNo }];
    if (activeId === 'coord-detail') return [{ label: 'Coordinators', onClick: () => navigate('coordinators') }, { label: page.context?.coordinatorName }];
    if (activeId === 'trainee-detail') return [{ label: page.context?.from || 'Dashboard', onClick: () => navigate(page.context?.fromId || 'dashboard') }, { label: page.context?.empId }];
    if (activeId === 'risk-detail') return [{ label: 'Dashboard', onClick: () => navigate('dashboard') }, { label: page.context?.level + ' Risk' }];
    return [];
  }

  const crumbs = getBreadcrumb();

  return (
    <div className="admin-shell">
      <div className="topnav">
        <div className="logo-wrap">
          <img src="/mcn-logo.png" alt="MCN" onError={e => { e.target.style.display='none'; }} />
          <span className="lms-badge">MCN LMS</span>
        </div>
        {crumbs.length > 0 && (
          <div className="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span style={{margin:'0 4px',opacity:.4}}>/</span>}
                {c.onClick ? <span className="crumb-link" onClick={c.onClick}>{c.label}</span> : <span>{c.label}</span>}
              </span>
            ))}
          </div>
        )}
        <div className="nav-right">
          <span className="nav-user">👤 {user?.adminId || 'Admin'}</span>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{ background: 'none', border: '1.5px solid rgba(128,128,128,.3)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 15, color: 'inherit', lineHeight: 1 }}
          >{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="btn small secondary" style={{ marginRight: 6 }} onClick={() => setShowPwModal(true)}>Change Password</button>
          <button className="nav-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="admin-body">
        <div className="sidebar">
          {NAV.map(section => (
            <div key={section.section}>
              <div className="sidebar-section">{section.section}</div>
              {section.items.map(item => (
                <div
                  key={item.id}
                  className={`nav-item${activeId === item.id ? ' active' : ''}`}
                  onClick={() => navigate(item.id)}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="admin-main">
          {activeId === 'dashboard' && <DashboardPage navigate={navigate} />}
          {activeId === 'curriculum' && <CurriculumTab />}
          {activeId === 'questions' && <QuestionsTab />}
          {activeId === 'drive' && <DriveTab />}
          {activeId === 'batches' && <BatchesPage navigate={navigate} />}
          {activeId === 'accounts' && <AccountsTab />}
          {activeId === 'coordinators' && <CoordinatorsPage navigate={navigate} />}
          {activeId === 'reports' && <ReportsTab />}
          {activeId === 'processlob' && <ProcessLobTab />}
          {activeId === 'certrules' && <CertRulesTab />}
          {activeId === 'branches' && <BranchTab />}
          {activeId === 'users' && <UsersTab />}
          {activeId === 'org' && <OrgTab />}
          {activeId === 'broadcast' && <BroadcastTab />}
          {activeId === 'emp-mapping' && <EmpIdMappingUpload />}
          {activeId === 'batch-detail' && <BatchDetailPage batchNo={page.context?.batchNo} navigate={navigate} onBack={() => navigate('batches')} />}
          {activeId === 'coord-detail' && <CoordDetailPage loginId={page.context?.loginId} coordinatorName={page.context?.coordinatorName} navigate={navigate} onBack={() => navigate('coordinators')} />}
          {activeId === 'trainee-detail' && <TraineeDetailPage empId={page.context?.empId} context={page.context} navigate={navigate} />}
          {activeId === 'risk-detail' && <RiskDrilldownPage level={page.context?.level} navigate={navigate} onBack={() => navigate('dashboard')} />}
        </div>
      </div>
      {showPwModal && (
        <div className="modal-overlay" onClick={() => setShowPwModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-head">
              <b>Change Admin Password</b>
              <button className="btn small secondary" onClick={() => setShowPwModal(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePassword} style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label>New Password</label>
                <input className="input" type="password" value={pwForm.password} onChange={e => setPwForm(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" required />
              </div>
              <div className="field">
                <label>Confirm Password</label>
                <input className="input" type="password" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat password" required />
              </div>
              {pwMsg && <div className="toast bad">{pwMsg}</div>}
              <button className="btn" type="submit">Update Password</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
