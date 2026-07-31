import { useMemo, useState } from 'react';
import { Link } from '../../utils/browserRouter.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import './infographics.css';

const roles = ['All', 'Trainee', 'Coordinator', 'Admin', 'Management', 'Operations'];

const stages = [
  {
    id: 'onboarding',
    number: '01',
    icon: '🪪',
    title: 'Trainee Onboarding',
    tagline: 'Create the learner identity and establish the training context.',
    audience: ['Coordinator', 'Admin'],
    owner: 'Training Coordinator',
    objective: 'Create a verified trainee record with the correct employee, branch, process, LOB and batch information before learning begins.',
    inputs: ['Employee ID and trainee profile', 'Branch, process and LOB', 'Date of joining and contact details', 'Selected batch or onboarding source'],
    systemActions: ['Blocks duplicate employee IDs', 'Creates the LMS user account', 'Applies first-login password reset', 'Writes onboarding and audit records'],
    evidence: ['Active trainee master record', 'User account linked to employee ID', 'Onboarding status updated', 'Source and creator captured'],
    gate: 'Verified learner account is active and mapped to a valid batch.',
    kpis: ['Onboarding completion %', 'Duplicate rejection count', 'Pending account activation', 'Time to LMS access'],
    outcome: 'The trainee can securely enter the LMS and is ready for classroom assignment.',
    tone: 'blue',
  },
  {
    id: 'assignment',
    number: '02',
    icon: '🧭',
    title: 'Batch & Classroom Assignment',
    tagline: 'Connect the learner to the right curriculum and delivery plan.',
    audience: ['Coordinator', 'Admin'],
    owner: 'Coordinator + LMS Admin',
    objective: 'Map the trainee and batch to the correct classroom so the day-wise curriculum, assessments and resources are available.',
    inputs: ['Batch number and training dates', 'Classroom ID and classroom name', 'Process/LOB curriculum mapping', 'Coordinator ownership'],
    systemActions: ['Creates batch-classroom mapping', 'Synchronizes classroom on trainee profile', 'Makes assigned modules visible', 'Preserves assignment timestamp and owner'],
    evidence: ['Active classroom mapping', 'Classroom visible on trainee dashboard', 'Expected days and modules available', 'Assignment audit trail'],
    gate: 'Trainee dashboard loads the correct classroom and curriculum structure.',
    kpis: ['Unassigned trainee count', 'Classroom mapping accuracy', 'Assignment turnaround time', 'Batch readiness %'],
    outcome: 'The learner sees the correct training journey from Day 1 onward.',
    tone: 'indigo',
  },
  {
    id: 'learning',
    number: '03',
    icon: '📚',
    title: 'Day-wise NHT Learning',
    tagline: 'Deliver sequenced learning through modules, content and guided practice.',
    audience: ['Trainee', 'Coordinator', 'Admin'],
    owner: 'Trainee + Training Team',
    objective: 'Complete the required day-wise curriculum in the intended order with measurable engagement and content completion.',
    inputs: ['Day and module sequence', 'Video, PDF, document and web content', 'Required content rules', 'Estimated learning time'],
    systemActions: ['Tracks open, heartbeat and close events', 'Calculates time spent and completion', 'Supports Drive preview and direct media', 'Locks or unlocks content based on rules'],
    evidence: ['Content progress record', 'Seconds spent and last position', 'Completed content count', 'Module and day completion status'],
    gate: 'Required content reaches its configured completion threshold.',
    kpis: ['Course completion %', 'Average learning time', 'Pending required content', 'Day-wise completion rate'],
    outcome: 'The trainee gains the knowledge required for assessment and supervised application.',
    tone: 'cyan',
  },
  {
    id: 'assessment',
    number: '04',
    icon: '🧠',
    title: 'Knowledge Checks & Q&A',
    tagline: 'Validate understanding and close learning gaps before progression.',
    audience: ['Trainee', 'Coordinator', 'Admin'],
    owner: 'Training + Subject Matter Expert',
    objective: 'Measure knowledge through controlled assessments while providing a structured channel for trainee questions and clarifications.',
    inputs: ['Question bank and answer keys', 'Pass mark, timer and attempt limit', 'Module-linked assessments', 'Trainee questions with category and priority'],
    systemActions: ['Runs timed MCQ attempts', 'Calculates score and pass result', 'Stores attempt history', 'Tracks Q&A status and response ageing'],
    evidence: ['Assessment attempt record', 'Best score and pass percentage', 'Answer review', 'Resolved or pending Q&A trail'],
    gate: 'Mandatory assessments are attempted and required pass thresholds are met.',
    kpis: ['MCQ completion %', 'Assessment pass %', 'Average score', 'Open Q&A ageing'],
    outcome: 'Knowledge gaps are visible, actionable and resolved before live practice.',
    tone: 'violet',
  },
  {
    id: 'readiness',
    number: '05',
    icon: '📊',
    title: 'Readiness & Risk Review',
    tagline: 'Convert learning signals into an evidence-based readiness decision.',
    audience: ['Coordinator', 'Management'],
    owner: 'Training Governance',
    objective: 'Evaluate progress, assessment, attendance and support indicators to identify trainees who are ready, at risk or require intervention.',
    inputs: ['Course completion percentage', 'Assessment performance', 'Attendance percentage', 'Open Q&A and risk signals'],
    systemActions: ['Calculates overall training progress', 'Applies automatic risk thresholds', 'Flags HEALTHY, WATCH, HIGH or CRITICAL', 'Surfaces pending activities for action'],
    evidence: ['Risk status and reason', 'Readiness review notes', 'Pending action ownership', 'Progress and attendance snapshot'],
    gate: 'No unresolved critical gap remains and the trainee is formally marked OJT ready.',
    kpis: ['OJT readiness %', 'Critical-risk trainee count', 'Intervention closure time', 'Attendance compliance %'],
    outcome: 'Only trainees meeting minimum readiness criteria move to supervised production practice.',
    tone: 'amber',
  },
  {
    id: 'ojt',
    number: '06',
    icon: '🛠️',
    title: 'OJT & Nesting',
    tagline: 'Apply classroom learning in a controlled operational environment.',
    audience: ['Trainee', 'Coordinator', 'Operations'],
    owner: 'Training + Operations',
    objective: 'Transition trainees from classroom knowledge to supervised task execution while tracking support needs and nesting status.',
    inputs: ['OJT-ready approval', 'Practice or production task plan', 'Coach and floor support allocation', 'Nesting status updates'],
    systemActions: ['Records OJT readiness', 'Tracks nesting stage', 'Supports evidence-based pending activities', 'Maintains risk visibility during transition'],
    evidence: ['OJT readiness flag', 'Nesting status', 'Coach observations', 'Remedial or support actions'],
    gate: 'Required OJT evidence is complete and nesting performance is acceptable.',
    kpis: ['OJT conversion %', 'Nesting completion %', 'Remedial action rate', 'Average time in nesting'],
    outcome: 'The trainee demonstrates stable, supported application of process knowledge.',
    tone: 'orange',
  },
  {
    id: 'certification',
    number: '07',
    icon: '🏅',
    title: 'Certification',
    tagline: 'Confirm that every mandatory quality and capability gate is passed.',
    audience: ['Coordinator', 'Admin', 'Management', 'Operations'],
    owner: 'Training + Quality + Operations',
    objective: 'Apply process-specific certification rules and capture evidence for mock, internal and external certification requirements.',
    inputs: ['Certification rule thresholds', 'Assessment and attendance results', 'Mock/internal/external evidence', 'Approver decision and remarks'],
    systemActions: ['Evaluates certification rule set', 'Stores evidence and status', 'Updates certified trainee counts', 'Keeps approval history auditable'],
    evidence: ['Certification status', 'Evidence references', 'Approver and decision date', 'Exception or re-certification notes'],
    gate: 'All mandatory certification conditions are approved with valid evidence.',
    kpis: ['Certification rate', 'First-attempt certification %', 'Pending certification count', 'Re-certification rate'],
    outcome: 'A formally certified learner is eligible for operational handover.',
    tone: 'green',
  },
  {
    id: 'handover',
    number: '08',
    icon: '🚀',
    title: 'Operations Handover',
    tagline: 'Transfer ownership with a complete, traceable learner readiness pack.',
    audience: ['Coordinator', 'Management', 'Operations'],
    owner: 'Coordinator + Operations Manager',
    objective: 'Complete the transition from training to operations with clear ownership, status and supporting readiness evidence.',
    inputs: ['Certified trainee list', 'Readiness and nesting evidence', 'Batch completion summary', 'Operations acceptance'],
    systemActions: ['Marks handover-to-operations status', 'Updates batch handover counts', 'Preserves acceptance evidence', 'Keeps management dashboards current'],
    evidence: ['Handover status and timestamp', 'Receiving operations owner', 'Batch closure summary', 'Outstanding action list'],
    gate: 'Operations accepts the trainee and no mandatory handover action remains open.',
    kpis: ['Handover conversion %', 'Training-to-operations lead time', 'Open handover actions', 'Post-handover exception rate'],
    outcome: 'The employee enters operations with a complete digital learning and readiness history.',
    tone: 'emerald',
  },
];

function StageMiniCard({ stage, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`infographic-stage-card tone-${stage.tone}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(stage.id)}
      aria-pressed={selected}
    >
      <span className="infographic-stage-number">{stage.number}</span>
      <span className="infographic-stage-icon" aria-hidden="true">{stage.icon}</span>
      <span className="infographic-stage-copy">
        <strong>{stage.title}</strong>
        <small>{stage.tagline}</small>
      </span>
      <span className="infographic-stage-arrow" aria-hidden="true">→</span>
    </button>
  );
}

function DetailList({ title, items, icon }) {
  return (
    <section className="infographic-detail-block">
      <div className="infographic-detail-heading"><span aria-hidden="true">{icon}</span><h3>{title}</h3></div>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}

export default function InfographicsPage() {
  const { theme, toggle: toggleTheme } = useTheme();
  const initialStage = new URLSearchParams(window.location.search).get('stage');
  const [selectedId, setSelectedId] = useState(stages.some((stage) => stage.id === initialStage) ? initialStage : stages[0].id);
  const [role, setRole] = useState('All');
  const [copyState, setCopyState] = useState('Copy stage link');

  const visibleStages = useMemo(
    () => role === 'All' ? stages : stages.filter((stage) => stage.audience.includes(role)),
    [role],
  );

  const selectedStage = stages.find((stage) => stage.id === selectedId) || stages[0];

  function chooseStage(id) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('stage', id);
    window.history.replaceState({}, '', url);
    window.requestAnimationFrame(() => document.getElementById('stage-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function copyStageLink() {
    const url = new URL(window.location.href);
    url.searchParams.set('stage', selectedStage.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyState('Link copied');
      window.setTimeout(() => setCopyState('Copy stage link'), 1600);
    } catch {
      setCopyState('Copy unavailable');
      window.setTimeout(() => setCopyState('Copy stage link'), 1600);
    }
  }

  return (
    <main className="infographic-page">
      <div className="infographic-shell">
        <header className="infographic-header">
          <Link to="/lms" className="infographic-brand" aria-label="Open LMS">
            <span className="infographic-brand-mark">LMS</span>
            <span><strong>MCN Learning Journey</strong><small>Stage-wise operating infographic</small></span>
          </Link>
          <div className="infographic-header-actions">
            <button className="btn small secondary" type="button" onClick={() => window.print()}>Print / Save PDF</button>
            <button className="infographic-theme" type="button" onClick={toggleTheme} aria-label="Toggle colour theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
            <Link className="btn small accent" to="/lms">Open LMS</Link>
          </div>
        </header>

        <section className="infographic-hero">
          <div className="infographic-hero-copy">
            <span className="infographic-eyebrow">End-to-end training governance</span>
            <h1>From onboarding to operations handover</h1>
            <p>Eight connected stages show who owns each step, what the LMS records, which evidence is required and what gate must be cleared before progression.</p>
            <div className="infographic-hero-actions">
              <button className="btn accent" type="button" onClick={() => document.getElementById('journey-map')?.scrollIntoView({ behavior: 'smooth' })}>Explore the journey</button>
              <button className="btn secondary" type="button" onClick={copyStageLink}>{copyState}</button>
            </div>
          </div>
          <div className="infographic-hero-visual" aria-label="Training journey summary">
            <div className="infographic-orbit orbit-one"><span>Learn</span></div>
            <div className="infographic-orbit orbit-two"><span>Validate</span></div>
            <div className="infographic-orbit orbit-three"><span>Certify</span></div>
            <div className="infographic-core"><strong>8</strong><span>Connected stages</span></div>
          </div>
        </section>

        <section className="infographic-summary" aria-label="Journey summary metrics">
          <article><strong>4</strong><span>Role-based portals</span></article>
          <article><strong>8</strong><span>Lifecycle stages</span></article>
          <article><strong>1</strong><span>Auditable learner record</span></article>
          <article><strong>100%</strong><span>Gate-based progression</span></article>
        </section>

        <section id="journey-map" className="infographic-map-section">
          <div className="infographic-section-head">
            <div>
              <span className="infographic-eyebrow">Journey map</span>
              <h2>Choose a stage to view its operating detail</h2>
            </div>
            <div className="infographic-role-filter" aria-label="Filter stages by audience">
              {roles.map((item) => (
                <button key={item} type="button" className={role === item ? 'active' : ''} onClick={() => setRole(item)}>{item}</button>
              ))}
            </div>
          </div>

          <div className="infographic-stage-grid">
            {visibleStages.map((stage) => (
              <StageMiniCard key={stage.id} stage={stage} selected={stage.id === selectedStage.id} onSelect={chooseStage} />
            ))}
          </div>
        </section>

        <section id="stage-detail" className={`infographic-detail tone-${selectedStage.tone}`}>
          <div className="infographic-detail-top">
            <div className="infographic-detail-title">
              <span className="infographic-detail-icon" aria-hidden="true">{selectedStage.icon}</span>
              <div>
                <span className="infographic-eyebrow">Stage {selectedStage.number}</span>
                <h2>{selectedStage.title}</h2>
                <p>{selectedStage.objective}</p>
              </div>
            </div>
            <div className="infographic-owner-card">
              <span>Primary owner</span>
              <strong>{selectedStage.owner}</strong>
              <div>{selectedStage.audience.map((item) => <span className="pill info" key={item}>{item}</span>)}</div>
            </div>
          </div>

          <div className="infographic-detail-grid">
            <DetailList title="Required inputs" items={selectedStage.inputs} icon="↘" />
            <DetailList title="What the LMS does" items={selectedStage.systemActions} icon="⚙" />
            <DetailList title="Evidence created" items={selectedStage.evidence} icon="✓" />
            <DetailList title="KPIs to monitor" items={selectedStage.kpis} icon="◎" />
          </div>

          <div className="infographic-gate-flow">
            <div><span>Progression gate</span><strong>{selectedStage.gate}</strong></div>
            <span className="infographic-gate-arrow" aria-hidden="true">→</span>
            <div><span>Stage outcome</span><strong>{selectedStage.outcome}</strong></div>
          </div>
        </section>

        <section className="infographic-governance">
          <div>
            <span className="infographic-eyebrow">Governance rule</span>
            <h2>No stage is only a status update</h2>
            <p>Each transition should have an accountable owner, measurable evidence, a completion timestamp and an explicit acceptance gate. This keeps training progress defensible for trainees, coordinators, management and operations.</p>
          </div>
          <div className="infographic-governance-loop" aria-label="Governance loop">
            {['Owner', 'Action', 'Evidence', 'Gate', 'Outcome'].map((item, index) => (
              <div key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></div>
            ))}
          </div>
        </section>

        <footer className="infographic-footer">
          <span>MCN LMS · Lifecycle infographic</span>
          <span>Route: /infographics</span>
        </footer>
      </div>
    </main>
  );
}
