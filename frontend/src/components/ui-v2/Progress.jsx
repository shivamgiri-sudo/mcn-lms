import React from 'react';

/**
 * Progress Components (ui-v2)
 * Linear and Radial progress indicators
 */

/**
 * LinearProgress - horizontal progress bar
 */
export function LinearProgress({
  value = 0,
  max = 100,
  size = 'md',
  color = 'primary',
  showLabel = false,
  animated = true,
  className = '',
  style: customStyle = {},
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

  const colorMap = {
    primary: 'var(--lms-primary)',
    success: 'var(--lms-success)',
    warning: 'var(--lms-warning)',
    error: 'var(--lms-error)',
    info: 'var(--lms-info)',
    blue: '#267abd',
    green: '#16a34a',
    amber: '#d97706',
    teal: '#0d9488',
  };

  const heightMap = { sm: 4, md: 8, lg: 12 };

  const trackStyle = {
    width: '100%',
    height: heightMap[size],
    background: 'var(--lms-bg-muted)',
    borderRadius: 'var(--lms-radius-full)',
    overflow: 'hidden',
    ...customStyle,
  };

  const fillStyle = {
    width: `${percent}%`,
    height: '100%',
    background: colorMap[color] || color,
    borderRadius: 'var(--lms-radius-full)',
    transition: animated ? 'width 0.5s ease' : 'none',
  };

  return (
    <div className={`lms-progress ${className}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={trackStyle}>
        <div style={fillStyle} />
      </div>
      {showLabel && (
        <span style={{ fontSize: 'var(--lms-text-sm)', fontWeight: 600, color: 'var(--lms-text-secondary)', minWidth: 36 }}>
          {Math.round(percent)}%
        </span>
      )}
    </div>
  );
}

/**
 * RadialProgress - circular progress (donut)
 */
export function RadialProgress({
  value = 0,
  max = 100,
  size = 64,
  strokeWidth = 6,
  color = 'primary',
  label,
  sublabel,
  className = '',
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  const colorMap = {
    primary: 'var(--lms-primary)',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
    info: '#0ea5e9',
    blue: '#267abd',
    green: '#16a34a',
    amber: '#d97706',
    teal: '#0d9488',
  };

  return (
    <div className={`lms-radial-progress ${className}`} style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--lms-bg-muted)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorMap[color] || color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
        }}
      >
        {label !== undefined ? (
          <>
            <div style={{ fontSize: size * 0.22, fontWeight: 800, color: colorMap[color] || color, fontFamily: 'var(--lms-font)' }}>
              {label}
            </div>
            {sublabel && (
              <div style={{ fontSize: size * 0.12, color: 'var(--lms-text-muted)', marginTop: 1 }}>
                {sublabel}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: size * 0.2, fontWeight: 800, color: colorMap[color] || color }}>
            {Math.round(percent)}%
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * XPBar - gamification XP progress bar
 */
export function XPBar({
  currentXP = 0,
  levelXP = 1000,
  level = 1,
  nextLevel = 2,
  className = '',
}) {
  const percent = Math.min(100, (currentXP / levelXP) * 100);

  return (
    <div className={`lms-xp-bar ${className}`} style={{ padding: '12px 16px', background: 'var(--lms-bg-card)', borderRadius: 'var(--lms-radius-lg)', border: '1px solid var(--lms-border-muted)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--lms-primary)' }}>Lv.{level}</span>
          <span style={{ fontSize: 12, color: 'var(--lms-text-muted)' }}>→ Lv.{nextLevel}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--lms-text)' }}>
          {currentXP.toLocaleString()} / {levelXP.toLocaleString()} XP
        </span>
      </div>
      <div style={{ width: '100%', height: 10, background: 'var(--lms-bg-muted)', borderRadius: 'var(--lms-radius-full)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--lms-primary), var(--lms-secondary))',
            borderRadius: 'var(--lms-radius-full)',
            transition: 'width 0.5s ease',
          }}
        />
      </div>
    </div>
  );
}

export default LinearProgress;
