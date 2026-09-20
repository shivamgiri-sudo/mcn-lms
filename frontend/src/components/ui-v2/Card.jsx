import React from 'react';

/**
 * Card Component (ui-v2)
 * Glass card with optional gradient header
 */
export function Card({
  children,
  header,
  headerGradient,
  padding = 'md',
  hover = false,
  className = '',
  style: customStyle = {},
  ...props
}) {
  const paddingMap = {
    none: '0',
    sm: 'var(--lms-space-3)',
    md: 'var(--lms-space-4)',
    lg: 'var(--lms-space-6)',
  };

  const gradientMap = {
    primary: 'linear-gradient(135deg, var(--lms-primary) 0%, var(--lms-primary-hover) 100%)',
    blue: 'linear-gradient(135deg, #267abd 0%, #1e5a8c 100%)',
    green: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
    purple: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
    amber: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
    teal: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
    pink: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
    mcn: 'linear-gradient(135deg, #267abd 0%, #76c053 50%, #dc363a 100%)',
  };

  const cardStyle = {
    background: 'var(--lms-bg-card)',
    borderRadius: 'var(--lms-radius-lg)',
    border: '1px solid var(--lms-border-muted)',
    boxShadow: 'var(--lms-shadow-sm)',
    overflow: 'hidden',
    transition: 'all var(--lms-transition)',
    ...customStyle,
  };

  const headerStyle = {
    background: gradientMap[headerGradient] || headerGradient || gradientMap.primary,
    color: 'var(--lms-text-inverse)',
    padding: 'var(--lms-space-4) var(--lms-space-5)',
    fontWeight: 600,
    fontSize: 'var(--lms-text-lg)',
  };

  const bodyStyle = {
    padding: paddingMap[padding],
  };

  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      className={`lms-card ${className}`}
      style={{
        ...cardStyle,
        ...(hover && isHovered ? { boxShadow: 'var(--lms-shadow-md)', transform: 'translateY(-2px)' } : {}),
      }}
      onMouseEnter={() => hover && setIsHovered(true)}
      onMouseLeave={() => hover && setIsHovered(false)}
      {...props}
    >
      {header && (
        <div className=lms-card-header style={headerStyle}>
          {header}
        </div>
      )}
      <div className=lms-card-body style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}

/**
 * CardHeader - standalone header component
 */
export function CardHeader({ children, gradient = 'primary', className = '', style = {} }) {
  const gradientMap = {
    primary: 'linear-gradient(135deg, var(--lms-primary) 0%, var(--lms-primary-hover) 100%)',
    blue: 'linear-gradient(135deg, #267abd 0%, #1e5a8c 100%)',
    green: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
    purple: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
    amber: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
  };

  return (
    <div
      className={`lms-card-header ${className}`}
      style={{
        background: gradientMap[gradient] || gradient,
        color: 'var(--lms-text-inverse)',
        padding: 'var(--lms-space-4) var(--lms-space-5)',
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * GlassCard - frosted glass effect
 */
export function GlassCard({ children, className = '', style = {}, ...props }) {
  return (
    <div
      className={`lms-glass-card ${className}`}
      style={{
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(8px)',
        borderRadius: 'var(--lms-radius-lg)',
        border: '1px solid rgba(255,255,255,0.6)',
        boxShadow: 'var(--lms-shadow)',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export default Card;
