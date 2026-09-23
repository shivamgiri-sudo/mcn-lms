import React from 'react';

/**
 * Button Component (ui-v2)
 * Variants: primary, secondary, ghost, destructive, accent
 * Sizes: sm, md, lg
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconRight,
  className = '',
  ...props
}) {
  const baseStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontFamily: 'var(--lms-font)',
    fontWeight: 600,
    borderRadius: 'var(--lms-radius)',
    border: 'none',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'all var(--lms-transition)',
    outline: 'none',
    whiteSpace: 'nowrap',
  };

  const sizeStyles = {
    sm: { padding: '6px 12px', fontSize: 'var(--lms-text-sm)' },
    md: { padding: '10px 18px', fontSize: 'var(--lms-text-base)' },
    lg: { padding: '12px 24px', fontSize: 'var(--lms-text-lg)' },
  };

  const variantStyles = {
    primary: {
      background: 'var(--lms-primary)',
      color: 'var(--lms-text-inverse)',
      boxShadow: '0 2px 8px rgba(13,148,136,0.3)',
    },
    secondary: {
      background: 'var(--lms-bg-muted)',
      color: 'var(--lms-text)',
      border: '1.5px solid var(--lms-border)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--lms-primary)',
    },
    destructive: {
      background: 'var(--lms-error)',
      color: 'var(--lms-text-inverse)',
      boxShadow: '0 2px 8px rgba(220,38,38,0.3)',
    },
    accent: {
      background: 'var(--lms-accent)',
      color: 'var(--lms-text-inverse)',
      boxShadow: '0 2px 8px rgba(217,119,6,0.35)',
    },
  };

  const style = {
    ...baseStyles,
    ...sizeStyles[size],
    ...variantStyles[variant],
  };

  return (
    <button
      style={style}
      disabled={disabled || loading}
      className={`lms-btn lms-btn-${variant} ${className}`}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          e.target.style.transform = 'translateY(-1px)';
          e.target.style.boxShadow = variantStyles[variant].boxShadow?.replace('0.3', '0.45') || 'var(--lms-shadow-md)';
        }
      }}
      onMouseLeave={(e) => {
        e.target.style.transform = 'translateY(0)';
        e.target.style.boxShadow = variantStyles[variant].boxShadow || 'none';
      }}
      onFocus={(e) => {
        e.target.style.boxShadow = `0 0 0 3px var(--lms-primary-light)`;
      }}
      onBlur={(e) => {
        e.target.style.boxShadow = variantStyles[variant].boxShadow || 'none';
      }}
      {...props}
    >
      {loading && (
        <svg width=16 height=16 viewBox=0 0 24 24 style={{ animation: 'spin 1s linear infinite' }}>
          <circle cx=12 cy=12 r=10 stroke=currentColor strokeWidth=3 fill=none strokeDasharray=31.4 31.4 />
        </svg>
      )}
      {!loading && icon}
      {children}
      {!loading && iconRight}
    </button>
  );
}

// Add keyframes for spinner
if (typeof document !== 'undefined' && !document.getElementById('lms-btn-keyframes')) {
  const style = document.createElement('style');
  style.id = 'lms-btn-keyframes';
  style.textContent = `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

export default Button;
