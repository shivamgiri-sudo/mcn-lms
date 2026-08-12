import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api.js';

const STATUS_META = {
  complete: { label: 'Complete', icon: '✓', tone: 'journey-ok' },
  current: { label: 'In progress', icon: '→', tone: 'journey-current' },
  attention: { label: 'Needs attention', icon: '!', tone: 'journey-attention' },
  locked: { label: 'Locked', icon: '🔒', tone: 'journey-locked' },
};

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
    else setError(result.message || 'Learning journey could not be loaded.');
  }

  useEffect(() => { loadJourney(); }, []);

  const nextStage = useMemo(
    () => journey?.stages?.find(stage => stage.id === journey.nextStageId),
    [journey],
  );

  if (loading) {
    return (
      <div className="journey-loading" aria-label="Loading learning journey">
        {[1, 2, 3, 4].map(item => <div key={item} className="skeleton skeleton-card" style={{ minHeight: 170 }} />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🧭</div>
        <h3 style={{ margin: '0 0 7px' }}>Journey unavailable</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>{error}</p>
        <button className="btn accent" onClick={loadJourney}>Try again</button>
      </div>
    );
  }

  if (!journey) return null;

  return (
    <section aria-labelledby="journey-title">
      <div className="journey-summary panel">
        <div>
          <div className="journey-eyebrow">Personal capability journey</div>
          <h2 id="journey-title">From onboarding to operations readiness</h2>
          <p>Every stage shows the evidence recorded by the LMS, the gate that must be met, and your next best action.</p>
        </div>
        <div className="journey-score" aria-label={`${journey.journeyProgressPct}% journey complete`}>
          <div className="journey-score-ring" style={{ '--journey-progress': `${journey.journeyProgressPct * 3.6}deg` }}>
            <div><strong>{journey.journeyProgressPct}%</strong><span>complete</span></div>
          </div>
          <div className="journey-score-note">{journey.completedStages}/{journey.totalStages} stages complete</div>
        </div>
      </div>

      <div className="journey-next card">
        <div className="journey-next-icon">{nextStage?.icon || '🧭'}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="journey-eyebrow">Recommended next action</div>
          <h3>{nextStage?.title || 'Continue development'}</h3>
          <p>{journey.nextAction}</p>
        </div>
        {onNavigate && nextStage?.id === 'learning' && <button className="btn small accent" onClick={() => onNavigate('learning')}>Open learning</button>}
        {onNavigate && nextStage?.id === 'assessment' && <button className="btn small accent" onClick={() => onNavigate('assessment')}>Open assessments</button>}
        {onNavigate && nextStage?.id === 'readiness' && <button className="btn small secondary" onClick={() => onNavigate('qa')}>Ask for support</button>}
      </div>

      <div className="journey-grid">
        {(journey.stages || []).map((stage, index) => {
          const meta = STATUS_META[stage.status] || STATUS_META.current;
          return (
            <article key={stage.id} className={`journey-card ${meta.tone}`} aria-current={stage.id === journey.nextStageId ? 'step' : undefined}>
              <div className="journey-card-top">
                <div className="journey-step-number">{String(stage.order).padStart(2, '0')}</div>
                <div className="journey-stage-icon" aria-hidden="true">{stage.icon}</div>
                <div className={`journey-status ${meta.tone}`}><span>{meta.icon}</span>{meta.label}</div>
              </div>

              <h3>{stage.title}</h3>
              <p className="journey-stage-summary">{stage.summary}</p>

              <div className="journey-progress-label"><span>Stage progress</span><strong>{Math.round(stage.progressPct || 0)}%</strong></div>
              <div className="journey-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, stage.progressPct || 0))}%` }} /></div>

              {stage.evidence?.length > 0 && (
                <dl className="journey-evidence">
                  {stage.evidence.map((item, evidenceIndex) => (
                    <div key={`${item.label}-${evidenceIndex}`}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="journey-action"><span aria-hidden="true">◎</span><p>{stage.action}</p></div>
              {index < (journey.stages || []).length - 1 && <div className="journey-connector" aria-hidden="true" />}
            </article>
          );
        })}
      </div>

      <div className="journey-policy card">
        <div>
          <div className="journey-eyebrow">Current certification gates</div>
          <h3>Requirements for your assigned programme</h3>
        </div>
        <div className="journey-policy-grid">
          <div><span>Course</span><strong>{journey.requirements?.courseCompletionPct ?? '—'}%</strong></div>
          <div><span>Assessment</span><strong>{journey.requirements?.assessmentPassPct ?? '—'}%</strong></div>
          <div><span>Attendance</span><strong>{journey.requirements?.attendancePct ?? '—'}%</strong></div>
          <div><span>Evidence</span><strong>{[
            journey.requirements?.mockCallRequired && 'Mock',
            journey.requirements?.internalCertificationRequired && 'Internal',
            journey.requirements?.externalCertificationRequired && 'External',
          ].filter(Boolean).join(' + ') || 'Standard'}</strong></div>
        </div>
      </div>

      <style>{`
        .journey-loading,.journey-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .journey-summary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:24px;padding:24px 28px;margin-bottom:12px;overflow:hidden;background:linear-gradient(135deg,var(--panel),color-mix(in srgb,var(--accent) 7%,var(--panel)))}
        .journey-summary h2{font-size:24px;line-height:1.18;letter-spacing:-.03em;margin:4px 0 8px}
        .journey-summary p,.journey-next p{font-size:13px;line-height:1.6;color:var(--muted);margin:0;max-width:650px}
        .journey-eyebrow{font-size:10.5px;font-weight:850;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
        .journey-score{text-align:center;min-width:130px}
        .journey-score-ring{--journey-progress:0deg;width:104px;height:104px;margin:0 auto 8px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--accent) var(--journey-progress),var(--line) 0);position:relative}
        .journey-score-ring:before{content:'';position:absolute;inset:9px;border-radius:50%;background:var(--panel)}
        .journey-score-ring>div{position:relative;z-index:1;display:flex;flex-direction:column}.journey-score-ring strong{font-size:22px}.journey-score-ring span,.journey-score-note{font-size:10.5px;color:var(--muted)}
        .journey-next{display:flex;align-items:center;gap:14px;padding:16px 20px;margin-bottom:14px;border-left:4px solid var(--accent)}
        .journey-next-icon{width:46px;height:46px;display:grid;place-items:center;border-radius:14px;background:var(--accent-soft);font-size:22px;flex:0 0 auto}.journey-next h3{font-size:16px;margin:3px 0 3px}
        .journey-card{position:relative;border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:18px;min-width:0;overflow:visible;box-shadow:0 8px 24px rgba(15,23,42,.035)}
        .journey-card.journey-current{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));box-shadow:0 10px 30px color-mix(in srgb,var(--accent) 12%,transparent)}
        .journey-card.journey-attention{border-color:color-mix(in srgb,var(--warn) 55%,var(--line))}.journey-card.journey-locked{opacity:.72}
        .journey-card-top{display:flex;align-items:center;gap:9px;margin-bottom:13px}.journey-step-number{font-size:10px;font-weight:900;color:var(--muted);letter-spacing:.08em}.journey-stage-icon{width:38px;height:38px;border-radius:12px;background:var(--bg);display:grid;place-items:center;font-size:19px}
        .journey-status{margin-left:auto;display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:5px 8px;font-size:9.5px;font-weight:850;white-space:nowrap}.journey-status.journey-ok{color:var(--ok);background:var(--ok-soft)}.journey-status.journey-current{color:var(--accent);background:var(--accent-soft)}.journey-status.journey-attention{color:var(--warn);background:var(--warn-soft)}.journey-status.journey-locked{color:var(--muted);background:var(--bg)}
        .journey-card h3{font-size:17px;letter-spacing:-.02em;margin:0 0 6px}.journey-stage-summary{font-size:12.2px;color:var(--muted);line-height:1.55;margin:0 0 15px;min-height:38px}
        .journey-progress-label{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-bottom:6px}.journey-progress-label strong{color:var(--text)}.journey-track{height:6px;background:var(--line);border-radius:99px;overflow:hidden}.journey-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),#8b5cf6)}
        .journey-evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:15px 0 0}.journey-evidence>div{min-width:0;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 9px}.journey-evidence dt{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:750;margin-bottom:3px}.journey-evidence dd{font-size:11.5px;font-weight:750;margin:0;overflow-wrap:anywhere}
        .journey-action{display:flex;gap:7px;align-items:flex-start;margin-top:13px;padding-top:12px;border-top:1px dashed var(--line);color:var(--accent)}.journey-action p{font-size:11.5px;line-height:1.45;color:var(--text);margin:0}
        .journey-connector{display:none}.journey-policy{display:grid;grid-template-columns:minmax(180px,.7fr) minmax(0,1.3fr);gap:20px;align-items:center;margin-top:14px;padding:20px}.journey-policy h3{font-size:16px;margin:4px 0 0}.journey-policy-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.journey-policy-grid>div{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;min-width:0}.journey-policy-grid span{display:block;color:var(--muted);font-size:9.5px;text-transform:uppercase;font-weight:750;margin-bottom:4px}.journey-policy-grid strong{font-size:12px;overflow-wrap:anywhere}
        @media(max-width:760px){.journey-summary{grid-template-columns:1fr;text-align:left;padding:20px}.journey-score{display:flex;align-items:center;gap:12px;text-align:left}.journey-score-ring{width:76px;height:76px;margin:0}.journey-score-ring:before{inset:7px}.journey-score-ring strong{font-size:17px}.journey-next{align-items:flex-start;flex-wrap:wrap}.journey-next .btn{width:100%}.journey-grid,.journey-loading{grid-template-columns:1fr}.journey-stage-summary{min-height:0}.journey-policy{grid-template-columns:1fr}.journey-policy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:390px){.journey-evidence{grid-template-columns:1fr}.journey-card{padding:15px}.journey-status{font-size:9px}.journey-policy-grid{grid-template-columns:1fr}}
      `}</style>
    </section>
  );
}
