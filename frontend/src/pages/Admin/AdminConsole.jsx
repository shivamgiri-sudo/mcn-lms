import { useState } from 'react';
import { api, setToken } from '../../utils/api.js';
import { useTheme } from '../../context/ThemeContext.jsx';
import CurriculumTab from './CurriculumTab.jsx';
import AccountsTab from './AccountsTab.jsx';
import QuestionsTab from './QuestionsTab.jsx';
import CertRulesTab from './CertRulesTab.jsx';
import DriveTab from './DriveTab.jsx';
import ContentRepositoryTab from './ContentRepositoryTab.jsx';
import IndependentModulesTab from './IndependentModulesTab.jsx';
import TalentArchitectureTab from './TalentArchitectureTab.jsx';
import EvidenceGovernanceTab from './EvidenceGovernanceTab.jsx';
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
import ComplianceExport from './ComplianceExport.jsx';
import CommConfigTab from './CommConfigTab.jsx';
import NotificationConfigTab from './NotificationConfigTab.jsx';
import SystemHealthTab from './SystemHealthTab.jsx';
import RuntimeOperationsTab from './RuntimeOperationsTab.jsx';
import AuditLogTab from './AuditLogTab.jsx';
import BulkImportTab from './BulkImportTab.jsx';
import TrainingCalendarEntryCard from '../TrainingCalendar/TrainingCalendarEntryCard.jsx';

const SUPER_ONLY = new Set(['branches', 'processlob', 'certrules', 'org', 'comm-config', 'notif-config', 'system-health', 'runtime-operations']);

const NAV = [
  { section: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: '📊' }] },
  { section: 'Training', items: [
    { id: 'curriculum', label: 'Curriculum', icon: '📋' },
    { id: 'live-training', label: 'Live Training Calendar', icon: '🗓️' },
    { id: 'content-repository', label: 'Content Repository', icon: '🗂️' },
    { id: 'independent-modules', label: 'Independent Modules', icon: '🧩' },
    { id: 'talent', label: 'Skills & Learning Paths', icon: '🎯' },
    { id: 'evidence-governance', label: 'Evidence & Verification', icon: '🧪' },
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
  { section: 'Reports', items: [{ id: 'reports', label: 'Reports & Exports', icon: '📥' }] },
  { section: 'Compliance', items: [
    { id: 'compliance-audit', label: 'Compliance Audit', icon: '🔒' },
    { id: 'audit-logs', label: 'Audit Logs', icon: '📋' },
  ]},
  { section: 'Import', items: [{ id: 'bulk-import', label: 'Bulk Import', icon: '📥' }] },
  { section: 'Config', items: [
    { id: 'processlob', label: 'Process & LOB', icon: '⚙️' },
    { id: 'certrules', label: 'Cert Rules', icon: '🎓' },
    { id: 'org', label: 'Organization', icon: '🏢' },
    { id: 'comm-config', label: 'Communications', icon: '📡' },
    { id: 'notif-config', label: 'Notifications', icon: '🔔' },
    { id: 'system-health', label: 'System Health', icon: '🛠️' },
    { id: 'runtime-operations', label: 'Runtime & Rollout', icon: '🚦' },
  ]},
];

function passwordPolicyError(password) {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
  if (!/\d/.test(password)) return 'Include a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include a special character.';
  return '';
}

export default function AdminConsole({ user, onLogout }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [page, setPage] = useState({ id: 'dashboard' });
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', password: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const isSuper = !user?.branch;

  async function handleChangePassword(event) {
    event.preventDefault();
    if (!pwForm.current || !pwForm.password || !pwForm.confirm) return setPwMsg('Complete all password fields.');
    const policyError = passwordPolicyError(pwForm.password);
    if (policyError) return setPwMsg(policyError);
    if (pwForm.password !== pwForm.confirm) return setPwMsg('Passwords do not match.');
    const res = await api.post('/admin/reset-password', { currentPassword: pwForm.current, password: pwForm.password }, 'admin');
    if (res.ok) {
      if (res.token) setToken('admin', res.token);
      setShowPwModal(false);
      setPwForm({ current: '', password: '', confirm: '' });
      setPwMsg('');
    } else setPwMsg(res.message || 'Failed to update password.');
  }

  function navigate(id, context) { setPage({ id, context }); }
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
        <div className="logo-wrap"><img src="/mcn-logo.png" alt="MCN" onError={e => { e.target.style.display='none'; }} /><span className="lms-badge">MCN LMS</span></div>
        {crumbs.length > 0 && <div className="breadcrumb">{crumbs.map((crumb, index) => <span key={index}>{index > 0 && <span style={{margin:'0 4px',opacity:.4}}>/</span>}{crumb.onClick ? <span className="crumb-link" onClick={crumb.onClick}>{crumb.label}</span> : <span>{crumb.label}</span>}</span>)}</div>}
        <div className="nav-right">
          <a className="btn small secondary" href="/training-calendar?role=admin">🗓️ Live Training</a>
          <span className="nav-user">👤 {user?.adminId || 'Admin'}{user?.branch ? <span style={{marginLeft:8,fontSize:10,opacity:.6,background:'rgba(128,128,128,.15)',padding:'2px 6px',borderRadius:4}}>{user.branch}</span> : null}</span>
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{ background: 'none', border: '1.5px solid rgba(128,128,128,.3)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', fontSize: 15, color: 'inherit', lineHeight: 1 }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <button className="btn small secondary" style={{ marginRight: 6 }} onClick={() => setShowPwModal(true)}>Change Password</button>
          <RoleSwitchButtons />
          <button className="nav-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="admin-body">
        <div className="sidebar">
          {NAV.map(section => {
            const items = isSuper ? section.items : section.items.filter(item => !SUPER_ONLY.has(item.id));
            if (!items.length) return null;
            return <div key={section.section}><div className="sidebar-section">{section.section}</div>{items.map(item => <div key={item.id} className={`nav-item${activeId === item.id ? ' active' : ''}`} onClick={() => navigate(item.id)}><span>{item.icon}</span><span>{item.label}</span></div>)}</div>;
          })}
        </div>

        <div className="admin-main">
          {activeId === 'dashboard' && <DashboardPage navigate={navigate} />}
          {activeId === 'curriculum' && <CurriculumTab />}
          {activeId === 'live-training' && <TrainingCalendarEntryCard role="admin" />}
          {activeId === 'content-repository' && <ContentRepositoryTab />}
          {activeId === 'independent-modules' && <IndependentModulesTab />}
          {activeId === 'talent' && <TalentArchitectureTab />}
          {activeId === 'evidence-governance' && <EvidenceGovernanceTab />}
          {activeId === 'questions' && <QuestionsTab />}
          {activeId === 'drive' && <DriveTab />}
          {activeId === 'batches' && <BatchesPage navigate={navigate} />}
          {activeId === 'accounts' && <AccountsTab />}
          {activeId === 'coordinators' && <CoordinatorsPage navigate={navigate} />}
          {activeId === 'reports' && <ReportsTab />}
          {activeId === 'compliance-audit' && <ComplianceExport />}
          {activeId === 'processlob' && <ProcessLobTab />}
          {activeId === 'certrules' && <CertRulesTab />}
          {activeId === 'branches' && <BranchTab />}
          {activeId === 'users' && <UsersTab />}
          {activeId === 'org' && <OrgTab />}
          {activeId === 'broadcast' && <BroadcastTab />}
          {activeId === 'emp-mapping' && <EmpIdMappingUpload />}
          {activeId === 'comm-config' && <CommConfigTab />}
          {activeId === 'notif-config' && <NotificationConfigTab />}
          {activeId === 'system-health' && <SystemHealthTab />}
          {activeId === 'runtime-operations' && <RuntimeOperationsTab />}
          {activeId === 'batch-detail' && <BatchDetailPage batchNo={page.context?.batchNo} navigate={navigate} onBack={() => navigate('batches')} />}
          {activeId === 'coord-detail' && <CoordDetailPage loginId={page.context?.loginId} coordinatorName={page.context?.coordinatorName} navigate={navigate} onBack={() => navigate('coordinators')} />}
          {activeId === 'trainee-detail' && <TraineeDetailPage empId={page.context?.empId} context={page.context} navigate={navigate} />}
          {activeId === 'risk-detail' && <RiskDrilldownPage level={page.context?.level} navigate={navigate} onBack={() => navigate('dashboard')} />}
        </div>
      </div>

      {showPwModal && (
        <div className="modal-overlay" onClick={() => setShowPwModal(false)}>
          <div className="modal-box" onClick={event => event.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-head"><b>Change Admin Password</b><button className="btn small secondary" onClick={() => setShowPwModal(false)}>✕</button></div>
            <form onSubmit={handleChangePassword} style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field"><label>Current Password</label><input className="input" type="password" autoComplete="current-password" value={pwForm.current} onChange={event => setPwForm(form => ({ ...form, current: event.target.value }))} required /></div>
              <div className="field"><label>New Password</label><input className="input" type="password" autoComplete="new-password" value={pwForm.password} onChange={event => setPwForm(form => ({ ...form, password: event.target.value }))} placeholder="10+ characters with mixed character types" required /></div>
              <div className="field"><label>Confirm New Password</label><input className="input" type="password" autoComplete="new-password" value={pwForm.confirm} onChange={event => setPwForm(form => ({ ...form, confirm: event.target.value }))} required /></div>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 11, lineHeight: 1.5 }}>Use uppercase, lowercase, a number, and a special character. Changing your password signs out other sessions.</p>
              {pwMsg && <div className="toast bad">{pwMsg}</div>}
              <button className="btn" type="submit">Update Password</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


// Opens the coordinator or learner view for the identities linked to this admin.
// The views open in a new tab so the admin console stays where it is; the role
// cookies are separate, so both sessions are live at once.
function RoleSwitchButtons() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function open(role) {
    setBusy(role);
    setError('');
    const res = await api.post('/auth/role-switch', { role }, 'admin');
    setBusy('');
    if (res.ok) window.open(res.redirectPath, '_blank', 'noopener');
    else setError(res.message || 'Could not open that view.');
  }

  return (
    <>
      <button className="btn small secondary" disabled={busy === 'coordinator'} onClick={() => open('coordinator')}
        title="Open the coordinator portal as your linked coordinator identity">
        {busy === 'coordinator' ? 'Opening…' : 'Coordinator view'}
      </button>
      <button className="btn small secondary" disabled={busy === 'trainee'} onClick={() => open('trainee')}
        title="Open the learner portal as your linked learner record">
        {busy === 'trainee' ? 'Opening…' : 'Learner view'}
      </button>
      {error && <span style={{ fontSize: 11.5, color: 'var(--bad)', maxWidth: 220 }}>{error}</span>}
    </>
  );
}
