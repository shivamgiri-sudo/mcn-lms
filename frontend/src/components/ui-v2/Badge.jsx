import React from 'react';

/**
 * Badge Component (ui-v2)
 * Status badges with tone colors
 */

const TONES = {
  // Success states
  success: { bg: '#eaf8ef', color: '#15803d', border: '#bbf7d0' },
  green: { bg: '#eaf8ef', color: '#15803d', border: '#bbf7d0' },
  
  // Warning states
  warning: { bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
  amber: { bg: '#fffbeb', color: '#b45309', border: '#fde68a' },
  
  // Error states
  error: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  red: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  
  // Info states
  info: { bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd' },
  blue: { bg: '#edf4ff', color: '#267abd', border: '#bfdbfe' },
  
  // Special states
  purple: { bg: '#f3efff', color: '#6d28d9', border: '#e6ddff' },
  violet: { bg: '#f3efff', color: '#6d28d9', border: '#e6ddff' },
  teal: { bg: '#f0fdfa', color: '#0d9488', border: '#5eead4' },
  pink: { bg: '#fdf2f8', color: '#db2777', border: '#fbcfe8' },
  
  // Neutral
  gray: { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' },
  slate: { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  
  // MCN brand
  mcn: { bg: '#edf4ff', color: '#267abd', border: '#bfdbfe' },
};

export function Badge({
  children,
  tone = 'gray',
  size = 'md',
  dot = false,
  icon,
  className = '',
  style: customStyle = {},
}) {
  const colors = TONES[tone] || TONES.gray;
  
  const sizeStyles = {
    sm: { padding: '2px 8px', fontSize: '10px' },
    md: { padding: '3px 10px', fontSize: '11px' },
    lg: { padding: '4px 12px', fontSize: '12px' },
  };

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: 'var(--lms-font)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderRadius: 'var(--lms-radius-full)',
    background: colors.bg,
    color: colors.color,
    border: `1px solid ${colors.border}`,
    whiteSpace: 'nowrap',
    ...sizeStyles[size],
    ...customStyle,
  };

  return (
    <span className={`lms-badge lms-badge-${tone} ${className}`} style={style}>
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: colors.color,
          }}
        />
      )}
      {icon}
      {children}
    </span>
  );
}

/**
 * StatusBadge - common status patterns
 */
export function StatusBadge({ status }) {
  const statusMap = {
    active: { label: 'Active', tone: 'success' },
    inactive: { label: 'Inactive', tone: 'gray' },
    pending: { label: 'Pending', tone: 'amber' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'error' },
    completed: { label: 'Completed', tone: 'success' },
    'in-progress': { label: 'In Progress', tone: 'blue' },
    certified: { label: 'Certified', tone: 'teal', dot: true },
    'at-risk': { label: 'At Risk', tone: 'error', dot: true },
  };

  const config = statusMap[status?.toLowerCase()] || { label: status, tone: 'gray' };
  return <Badge tone={config.tone} dot={config.dot}>{config.label}</Badge>;
}

export default Badge;
