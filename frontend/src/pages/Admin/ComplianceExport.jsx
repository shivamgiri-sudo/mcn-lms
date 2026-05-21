import { useState, useEffect } from 'react';
import { api, downloadCsv } from '../../utils/api.js';

const CHART_COLORS = {
  blue: '#1d4ed8', green: '#16a34a', red: '#dc2626',
  amber: '#d97706', purple: '#7c3aed', teal: '#0891b2',
};

function PreviewCard({ label, count, color }) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)',
      padding: '14px 18px', boxShadow: 'var(--shadow-sm)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: color || 'var(--ink)' }}>
        {count == null ? '—' : count.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}

function ExportCard({ icon, title, desc, cols, btnColor, disabled, onExport, loading }) {
  return (
    <div style={{
      background: 'var(--card-solid)', borderRadius: 16, border: '1.5px solid var(--line)',
      padding: '20px 22px', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 12,
      opacity: disabled ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `${btnColor}22`, display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
        </div>
      </div>
      {cols && (
        <div style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--card)', borderRadius: 8, padding: '6px 10px', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--ink)' }}>Columns:</b> {cols}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn"
          style={{ background: btnColor, padding: '7px 18px', fontSize: 12 }}
          onClick={onExport}
          disabled={disabled || loading}
        >
          {loading ? 'Exporting…' : '⬇ Export CSV'}
        </button>
      </div>
    </div>
  );
}

export default function ComplianceExport() {
  const [branches, setBranches] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [form, setForm] = useState({ dateFrom: '', dateTo: '', branch: '', process: '' });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/broadcast-targets', 'admin').then(r => {
      if (r.ok) {
        setBranches(r.data.branches || []);
        setProcesses(r.data.processes || []);
      }
    });
  }, []);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function hasDateRange() { return form.dateFrom && form.dateTo; }

  function validate() {
    if (!form.dateFrom || !form.dateTo) return 'Date From and Date To are required.';
    if (form.dateTo < form.dateFrom) return 'Date To must be on or after Date From.';
    return '';
  }

  async function loadPreview() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setPreviewLoading(true);
    setPreview(null);
    const params = new URLSearchParams({ dateFrom: form.dateFrom, dateTo: form.dateTo });
    if (form.branch) params.set('branch', form.branch);
    if (form.process) params.set('process', form.process);
    const r = await api.get(`/admin/compliance/preview?${params}`, 'admin');
    setPreviewLoading(false);
    if (r.ok) setPreview(r.data);
    else setError(r.message || 'Preview failed.');
  }

  async function doExport(key, path) {
    if (key !== 'trainees') {
      const err = validate();
      if (err) { setError(err); return; }
    }
    setError('');
    setExportLoading(s => ({ ...s, [key]: true }));
    const params = new URLSearchParams();
    if (key !== 'trainees') {
      if (form.dateFrom) params.set('dateFrom', form.dateFrom);
      if (form.dateTo) params.set('dateTo', form.dateTo);
    }
    if (form.branch) params.set('branch', form.branch);
    if (form.process) params.set('process', form.process);
    const d = new Date().toISOString().slice(0, 10);
    try {
      await downloadCsv(`/admin/compliance/${path}?${params}`, `compliance-${key}-${d}.csv`, 'admin');
    } catch {
      setError('Export failed. Please try again.');
    }
    setExportLoading(s => ({ ...s, [key]: false }));
  }

  const dateRangeOk = hasDateRange() && form.dateTo >= form.dateFrom;

  const exports = [
    {
      key: 'trainees',
      icon: '👥', title: 'Full Trainee Register', btnColor: CHART_COLORS.blue,
      desc: 'All trainees regardless of status — active, inactive, and deleted. No date filter. Snapshot.',
      cols: 'Employee ID, ID Type, Name, Email, Mobile, Batch No, Branch, Process, LOB, Batch Start/End, Coordinator, Onboarding Date, Status, Cert Status, OJT Ready, Handover to Ops, Course %, MCQ %, Attendance %, Risk, Last Updated',
      path: 'export/trainees',
    },
    {
      key: 'attendance-login',
      icon: '📅', title: 'Attendance & Login', btnColor: CHART_COLORS.teal,
      desc: 'Daily attendance records and login session events for all trainees in the date range.',
      cols: 'Employee ID, Name, Batch No, Branch, Process, Record Type, Date, Attendance Status, Source, Course Activity, MCQ Activity, Login Action, Login Status, IP Address, Created At',
      path: 'export/attendance-login',
    },
    {
      key: 'learning',
      icon: '📚', title: 'Learning Activity', btnColor: CHART_COLORS.purple,
      desc: 'Content progress and assessment attempts within the date range for all trainees.',
      cols: 'Employee ID, Name, Batch No, Branch, Process, Record Type, Module ID, Title, Status, Completion %, Score %, Pass/Fail, First Opened, Last Opened, Completed At, Time Spent (mins), Attempt No, Started At, Submitted At',
      path: 'export/learning',
    },
    {
      key: 'risk-escalation',
      icon: '⚠️', title: 'Risk & Escalation Trail', btnColor: CHART_COLORS.red,
      desc: 'Risk flags, pending activity alerts, and trainee queries raised within the date range.',
      cols: 'Employee ID, Name, Batch No, Branch, Process, Record Type, Category/Type, Description/Query, Status, Priority/Severity, Raised/Created At, Actioned At, Resolved/Closed At, Actioned By, Remarks/Answer',
      path: 'export/risk-escalation',
    },
    {
      key: 'certification',
      icon: '🏆', title: 'Certification Chain', btnColor: CHART_COLORS.green,
      desc: 'Certification evidence conducted in the date range, plus latest assessment results snapshot.',
      cols: 'Employee ID, Name, Batch No, Branch, Process, Record Type, Evidence Type/Assessment ID, Score %, Result, Conducted/Completed At, Assessor/Conducted By, Total Attempts, Last Attempt At, Cert Status, Remarks',
      path: 'export/certification',
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: 'var(--ink)' }}>Compliance Audit Export</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Auditor-grade bulk exports covering all trainees regardless of active/inactive status.
          Set a date range, optionally scope by branch or process, preview record counts, then export.
        </p>
      </div>

      {/* Filter Panel */}
      <div style={{ background: 'var(--card-solid)', borderRadius: 14, border: '1.5px solid var(--line)', padding: '18px 22px', marginBottom: 24, boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', marginBottom: 14 }}>Filters</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Date From <span style={{ color: 'var(--bad)' }}>*</span></label>
            <input className="input" type="date" value={form.dateFrom} onChange={e => set('dateFrom', e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Date To <span style={{ color: 'var(--bad)' }}>*</span></label>
            <input className="input" type="date" value={form.dateTo} onChange={e => set('dateTo', e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Branch (optional)</label>
            <select className="select" value={form.branch} onChange={e => set('branch', e.target.value)}>
              <option value="">All Branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Process (optional)</label>
            <select className="select" value={form.process} onChange={e => set('process', e.target.value)}>
              <option value="">All Processes</option>
              {processes.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button
            className="btn"
            style={{ flexShrink: 0, height: 38 }}
            onClick={loadPreview}
            disabled={previewLoading || !hasDateRange()}
          >
            {previewLoading ? 'Loading…' : 'Preview'}
          </button>
        </div>
        {error && <div className="toast bad" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {/* Preview counts */}
      {preview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
          <PreviewCard label="Trainees" count={preview.trainees} color={CHART_COLORS.blue} />
          <PreviewCard label="Attendance & Login" count={preview.attendanceAndLogin} color={CHART_COLORS.teal} />
          <PreviewCard label="Learning Activity" count={preview.learningActivity} color={CHART_COLORS.purple} />
          <PreviewCard label="Risk & Escalation" count={preview.riskAndEscalation} color={CHART_COLORS.red} />
          <PreviewCard label="Certification Chain" count={preview.certificationChain} color={CHART_COLORS.green} />
        </div>
      )}

      {/* Export Cards */}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 14 }}>
        Export Reports — 5 Available
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {exports.map(exp => (
          <ExportCard
            key={exp.key}
            icon={exp.icon}
            title={exp.title}
            desc={exp.desc}
            cols={exp.cols}
            btnColor={exp.btnColor}
            disabled={exp.key !== 'trainees' && !dateRangeOk}
            loading={!!exportLoading[exp.key]}
            onExport={() => doExport(exp.key, exp.path)}
          />
        ))}
      </div>

      {!dateRangeOk && (
        <div style={{ marginTop: 16, padding: '10px 16px', background: 'var(--card)', borderRadius: 10, border: '1px solid var(--line)', fontSize: 12, color: 'var(--muted)' }}>
          Set a valid date range to enable exports.
        </div>
      )}
    </div>
  );
}
