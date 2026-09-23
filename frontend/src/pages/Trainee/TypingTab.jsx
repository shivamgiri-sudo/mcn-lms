import { useState } from 'react';
import TypingPracticeTab from './TypingPracticeTab.jsx';
import DailyTypingTestTab from './DailyTypingTestTab.jsx';

/**
 * Unified Typing tab combining:
 * - Practice: unlimited skill-building with passages/drills
 * - Daily Test: once-per-day formal assessment with pass/fail
 */
export default function TypingTab() {
  const [activeSubTab, setActiveSubTab] = useState('practice');

  const subTabs = [
    { id: 'practice', label: '⌨️ Practice', desc: 'Unlimited practice sessions' },
    { id: 'daily-test', label: '📝 Daily Test', desc: 'Once-per-day assessment' },
  ];

  return (
    <div>
      {/* Sub-tab navigation */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--line)', marginBottom: 16 }}>
        {subTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={activeSubTab === tab.id ? 'active' : ''}
            style={{
              padding: '12px 20px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 700,
              color: activeSubTab === tab.id ? 'var(--brand)' : 'var(--muted)',
              borderBottom: activeSubTab === tab.id ? '2px solid var(--brand)' : '2px solid transparent',
              marginBottom: -2,
              transition: 'all 0.15s ease',
            }}
            title={tab.desc}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {activeSubTab === 'practice' && <TypingPracticeTab />}
      {activeSubTab === 'daily-test' && <DailyTypingTestTab />}
    </div>
  );
}
