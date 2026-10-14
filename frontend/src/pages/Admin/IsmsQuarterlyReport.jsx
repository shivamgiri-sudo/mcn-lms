import { useState } from 'react';
import { ReportPanel } from './LmsActivityReports.jsx';

// Financial years run April-March; Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar.
function financialYears(count = 4) {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const start = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = start - i;
    return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
}

const QUARTERS = [['1', 'Q1 (Apr–Jun)'], ['2', 'Q2 (Jul–Sep)'], ['3', 'Q3 (Oct–Dec)'], ['4', 'Q4 (Jan–Mar)']];

export default function IsmsQuarterlyReport() {
  const [fy, setFy] = useState('');
  const [quarter, setQuarter] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const field = (label, node) => <div className="field" style={{ margin: 0 }}><label>{label}</label>{node}</div>;

  return (
    <ReportPanel
      title="🛡️ ISMS Quarterly Assessment Results"
      desc="Every quarter is its own assignment, attempt, score and status, so a pass in one quarter never carries into the next. All quarters stay available here."
      path="/isms-quarterly/report"
      previewQuery="format=json"
      filename={() => `isms-quarterly-${(fy || 'all').replace(/\s+/g, '')}${quarter ? `-Q${quarter}` : ''}.xlsx`}
      filters={(
        <>
          {field('Financial Year', (
            <select className="select" value={fy} onChange={e => setFy(e.target.value)}>
              <option value="">All years</option>
              {financialYears().map(label => <option key={label} value={label}>{label}</option>)}
            </select>
          ))}
          {field('Quarter', (
            <select className="select" value={quarter} onChange={e => setQuarter(e.target.value)}>
              <option value="">All quarters</option>
              {QUARTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          ))}
          {field('Employee ID', <input className="input" value={employeeId} onChange={e => setEmployeeId(e.target.value)} placeholder="Employee ID" />)}
        </>
      )}
      extraFields={(
        <>
          {field('Completion Status', (
            <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="Completed">Completed (passed)</option>
              <option value="Attempted">Attempted, not passed</option>
              <option value="Not Attempted">Not Attempted</option>
            </select>
          ))}
          {field('Min score %', <input className="input" type="number" min="0" max="100" style={{ width: 90 }} value={minScore} onChange={e => setMinScore(e.target.value)} />)}
          {field('Max score %', <input className="input" type="number" min="0" max="100" style={{ width: 90 }} value={maxScore} onChange={e => setMaxScore(e.target.value)} />)}
        </>
      )}
      buildParams={() => new URLSearchParams({ fy, quarter, employeeId: employeeId.trim(), status, minScore, maxScore }).toString()}
    />
  );
}
