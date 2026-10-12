import { useEffect, useState } from 'react';
import { api } from '../../utils/api.js';

const CERT_TONE = { Certified: 'journey-ok', 'In Progress': 'journey-current', 'Not Certified': 'journey-locked' };
const ASSESS_TONE = { Pass: 'journey-ok', Fail: 'journey-attention', Pending: 'journey-current', 'Not Required': 'journey-locked' };

export default function LearningJourneyTab({ onNavigate }) {
  const [journey, setJourney] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadJourney() {
    setLoading(true);
    setError('');
    const result = await api.get('/trainee/journey', 'trainee');
    setLoading(false);
    if (result.ok) setJourney(result.data);
    else setError(result.message || 'Certification journey could not be loaded.');
  }

  useEffect(() => { loadJourney(); }, []);

  if (loading) {
    return (
      <div className="journey-loading" aria-label="Loading certification journey">
        {[1, 2].map(item => <div key={item} className="skeleton skeleton-card" style={{ minHeight: 140 }} />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🧭</div>
        <h3 style={{ margin: '0 0 7px' }}>Certification journey unavailable</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>{error}</p>
        <button className="btn accent" onClick={loadJourney}>Try again</button>
      </div>
    );
  }

  if (!journey) return null;
  const classrooms = journey.classrooms || [];
  const processes = journey.processes || [];

  return (
    <section aria-labelledby="journey-title">
      <div className="journey-summary panel">
        <div>
          <div className="journey-eyebrow">Process certification</div>
          <h2 id="journey-title">My Process Certification Journey</h2>
          <p>Your certification is based on your assigned classrooms: every required module completed and every assessment passed.</p>
        </div>
        <div className="journey-score" aria-label={`${journey.overallProgressPct}% certification complete`}>
          <div className="journey-score-ring" style={{ '--journey-progress': `${journey.overallProgressPct * 3.6}deg` }}>
            <div><strong>{journey.overallProgressPct}%</strong><span>{journey.overallCertified ? 'certified' : 'complete'}</span></div>
          </div>
          <div className="journey-score-note">{journey.classroomsCertified}/{journey.classroomsTotal} classrooms certified</div>
        </div>
      </div>

      {classrooms.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🏫</div>
          <h3 style={{ margin: '0 0 7px' }}>No classrooms assigned yet</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Your coordinator will assign your classrooms. They will appear here with your progress.</p>
        </div>
      ) : (
        <>
          <div className="journey-process-grid">
            {processes.map(proc => (
              <article key={proc.process} className={`journey-card ${CERT_TONE[proc.certificationStatus] || ''}`}>
                <div className="journey-card-top">
                  <div className="journey-stage-icon" aria-hidden="true">{proc.certificationStatus === 'Certified' ? '🎓' : '📘'}</div>
                  <h3 style={{ margin: 0 }}>{proc.process}</h3>
                  <div className={`journey-status ${CERT_TONE[proc.certificationStatus] || ''}`}>
                    {proc.certificationStatus === 'Certified' ? '✓ 100% – Certified' : proc.certificationStatus}
                  </div>
                </div>
                <div className="journey-progress-label"><span>{proc.classroomsCertified}/{proc.classroomsTotal} classrooms certified</span><strong>{proc.progressPct}%</strong></div>
                <div className="journey-track" aria-hidden="true"><span style={{ width: `${proc.progressPct}%` }} /></div>
              </article>
            ))}
          </div>

          <div className="journey-classrooms">
            {classrooms.map(room => (
              <article key={room.classroomId} className="journey-card">
                <div className="journey-room-head">
                  <div style={{ minWidth: 0 }}>
                    <h3>{room.classroomName}</h3>
                    <div className="journey-room-process">{room.process}</div>
                  </div>
                  <div className={`journey-status ${CERT_TONE[room.certificationStatus] || ''}`}>{room.certificationStatus}</div>
                </div>
                <div className="journey-progress-label">
                  <span>Completion ({room.contentsCompleted}/{room.contentsTotal} required items)</span>
                  <strong>{room.completionPct}%</strong>
                </div>
                <div className="journey-track" aria-hidden="true"><span style={{ width: `${room.completionPct}%` }} /></div>
                <div className="journey-room-assess">
                  <span>Assessment</span>
                  <div className={`journey-status ${ASSESS_TONE[room.assessmentResult] || ''}`}>
                    {room.assessmentResult}{room.assessmentsTotal > 0 ? ` · ${room.assessmentsPassed}/${room.assessmentsTotal} passed` : ''}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {onNavigate && classrooms.some(r => r.certificationStatus !== 'Certified') && (
        <div style={{ marginTop: 14 }}>
          <button className="btn accent" onClick={() => onNavigate('learning')}>Open my classrooms</button>
        </div>
      )}

      <style>{`
        .journey-loading,.journey-process-grid,.journey-classrooms{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}
        .journey-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:24px;padding:24px 28px;margin-bottom:14px;overflow:hidden;background:linear-gradient(135deg,var(--panel),color-mix(in srgb,var(--accent) 7%,var(--panel)))}
        .journey-summary h2{font-size:24px;line-height:1.18;letter-spacing:-.03em;margin:4px 0 8px}
        .journey-summary p{font-size:13px;line-height:1.6;color:var(--muted);margin:0;max-width:650px}
        .journey-eyebrow{font-size:10.5px;font-weight:850;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
        .journey-score{text-align:center;min-width:130px}
        .journey-score-ring{--journey-progress:0deg;width:104px;height:104px;margin:0 auto 8px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--accent) var(--journey-progress),var(--line) 0);position:relative}
        .journey-score-ring:before{content:'';position:absolute;inset:9px;border-radius:50%;background:var(--panel)}
        .journey-score-ring>div{position:relative;z-index:1;display:flex;flex-direction:column}.journey-score-ring strong{font-size:22px}.journey-score-ring span,.journey-score-note{font-size:10.5px;color:var(--muted)}
        .journey-card{position:relative;border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:18px;min-width:0;box-shadow:0 8px 24px rgba(15,23,42,.035)}
        .journey-card.journey-ok{border-color:color-mix(in srgb,var(--ok) 55%,var(--line))}
        .journey-card-top{display:flex;align-items:center;gap:9px;margin-bottom:13px}.journey-stage-icon{width:38px;height:38px;border-radius:12px;background:var(--bg);display:grid;place-items:center;font-size:19px;flex:0 0 auto}
        .journey-status{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:850;white-space:nowrap}.journey-status.journey-ok{color:var(--ok);background:var(--ok-soft)}.journey-status.journey-current{color:var(--accent);background:var(--accent-soft)}.journey-status.journey-attention{color:var(--warn);background:var(--warn-soft)}.journey-status.journey-locked{color:var(--muted);background:var(--bg)}
        .journey-card h3{font-size:16px;letter-spacing:-.02em;margin:0 0 3px;overflow-wrap:anywhere}
        .journey-room-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px}.journey-room-process{font-size:11.5px;color:var(--muted)}
        .journey-progress-label{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;color:var(--muted);margin-bottom:6px}.journey-progress-label strong{color:var(--text)}.journey-track{height:6px;background:var(--line);border-radius:99px;overflow:hidden}.journey-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),#8b5cf6)}
        .journey-room-assess{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--line);font-size:11.5px;color:var(--muted)}.journey-room-assess .journey-status{margin-left:0}
        @media(max-width:760px){.journey-summary{grid-template-columns:1fr;text-align:left;padding:20px}.journey-score{display:flex;align-items:center;gap:12px;text-align:left}.journey-score-ring{width:76px;height:76px;margin:0}.journey-score-ring:before{inset:7px}.journey-score-ring strong{font-size:17px}.journey-loading,.journey-process-grid,.journey-classrooms{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
