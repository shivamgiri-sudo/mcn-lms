import { useState } from 'react';

export default function DeleteClassroomModal({ classroom, onCancel, onConfirm, error }) {
  const [step, setStep] = useState(1);
  const [typedName, setTypedName] = useState('');
  const [typedConfirm, setTypedConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (typedName !== classroom.classroomName) return;
    if (typedConfirm !== 'DELETE') return;
    setBusy(true);
    await onConfirm(typedName);
    setBusy(false);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <b style={{ color: '#f87171' }}>🗑 Delete Classroom</b>
          <button className="btn small secondary" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          {step === 1 && (
            <div>
              <div style={{ background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
                <div style={{ fontWeight: 700, color: '#f87171', marginBottom: 6 }}>⚠ This action is permanent and cannot be undone.</div>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
                  Deleting <b>{classroom.classroomName}</b> will permanently remove:
                  <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: 12 }}>
                    <li>All modules, content and FAQs</li>
                    <li>All assessments and questions</li>
                    <li>All learner progress and completion records</li>
                    <li>All assessment attempt history</li>
                  </ul>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn secondary" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
                <button style={{ flex: 1, background: 'rgba(220,38,38,.85)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }} onClick={() => setStep(2)}>
                  I understand, proceed
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 16, lineHeight: 1.6 }}>
                To confirm deletion of <b>{classroom.classroomName}</b>, type the classroom name exactly as shown, then type <b>DELETE</b> in the second field.
              </div>
              <div className="field">
                <label>Type classroom name: <b>{classroom.classroomName}</b></label>
                <input className="input" value={typedName} onChange={e => setTypedName(e.target.value)} placeholder={classroom.classroomName} />
              </div>
              <div className="field">
                <label>Type <b>DELETE</b> to confirm</label>
                <input className="input" value={typedConfirm} onChange={e => setTypedConfirm(e.target.value.toUpperCase())} placeholder="DELETE" />
              </div>
              {error && <div className="toast bad" style={{ marginBottom: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn secondary" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
                <button
                  style={{ flex: 1, background: typedName === classroom.classroomName && typedConfirm === 'DELETE' ? 'rgba(220,38,38,.85)' : 'rgba(150,150,150,.3)', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '9px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13, transition: 'background .15s' }}
                  onClick={handleDelete}
                  disabled={busy || typedName !== classroom.classroomName || typedConfirm !== 'DELETE'}
                >
                  {busy ? 'Deleting...' : 'Delete Permanently'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
