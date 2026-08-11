import { useTheme } from '../context/ThemeContext.jsx';

const PATHS = {
  path:      'M4 6h10M4 12h16M4 18h7',
  verified:  'M20 6L9 17l-5-5',
  award:     'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 13.5L7 22l5-2.5L17 22l-1.5-8.5',
  shield:    'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  users:     'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 7.5a3 3 0 1 0 0 .01M21 19v-1a4 4 0 0 0-3-3.8',
  clipboard: 'M9 4h6v3H9zM7 5H5v15h14V5h-2',
  gauge:     'M12 14l4-4M20 16a8 8 0 1 0-16 0',
  sun:       'M12 4V2M12 22v-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M4 12H2M22 12h-2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
  moon:      'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  eye:       'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z',
  eyeOff:    'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 3.5-.6',
  arrow:     'M5 12h14M13 6l6 6-6 6',
};

export function AuthIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
      {name === 'sun' && <circle cx="12" cy="12" r="4" />}
      {name === 'eye' && <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

export const AUTH_CSS = [
  '.lms-login-root{font-family:"Source Sans 3",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}',
  '.lms-display{font-family:"Lexend","Source Sans 3",ui-sans-serif,system-ui,sans-serif;}',
  '.lms-field{transition:border-color .18s ease,box-shadow .18s ease;}',
  '.lms-field:focus{border-color:#1d4ed8;box-shadow:0 0 0 3px rgba(29,78,216,.18);}',
  '.lms-primary{transition:background-color .18s ease,transform .12s ease;}',
  '.lms-primary:hover:not(:disabled){background:#1a45bd;}',
  '.lms-primary:active:not(:disabled){transform:translateY(1px);}',
  '.lms-icon-btn{transition:color .18s ease,border-color .18s ease;}',
  '.lms-icon-btn:hover{color:#1d4ed8;}',
  '.lms-link:hover{text-decoration:underline;}',
  '.lms-login-root :focus-visible{outline:2px solid #1d4ed8;outline-offset:2px;border-radius:4px;}',
  '@media (max-width:900px){.lms-login-brand{display:none !important;}',
  '.lms-login-panel{width:100% !important;border-left:none !important;padding:28px 22px !important;}}',
  '@media (prefers-reduced-motion:reduce){.lms-login-root *{transition:none !important;}}',
].join('');

export function authTokens(dark) {
  const ink      = dark ? '#f2f5fb'               : '#0f1729';
  const inkSoft  = dark ? 'rgba(226,235,250,.62)' : '#4a5468';
  const fieldLine = dark ? 'rgba(255,255,255,.14)' : '#d3d9e4';
  return {
    ink,
    inkSoft,
    fieldLine,
    panelBg: dark ? '#111726' : '#ffffff',
    labelStyle: {
      display: 'block', fontSize: 12.5, fontWeight: 600,
      color: dark ? 'rgba(226,235,250,.74)' : '#3d4759', marginBottom: 7,
    },
    inputStyle: {
      width: '100%',
      background: dark ? 'rgba(255,255,255,.05)' : '#f4f6fa',
      border: '1.5px solid ' + fieldLine,
      borderRadius: 10,
      padding: '13px 14px',
      color: ink,
      fontSize: 15,
      outline: 'none',
      fontFamily: 'inherit',
    },
    primaryBtn: busy => ({
      width: '100%', minHeight: 48, padding: '14px 0', borderRadius: 10, border: 'none',
      cursor: busy ? 'progress' : 'pointer',
      background: busy ? '#7891d6' : '#1d4ed8',
      color: '#ffffff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }),
    notice: good => ({
      background: dark
        ? (good ? 'rgba(45,212,191,.12)' : 'rgba(248,113,113,.12)')
        : (good ? '#e6f7f3'              : '#fdeceb'),
      border: '1px solid ' + (dark
        ? (good ? 'rgba(45,212,191,.30)' : 'rgba(248,113,113,.32)')
        : (good ? '#b7e6da'              : '#f5c6c2')),
      color: dark
        ? (good ? '#7ddcc7' : '#ffa79f')
        : (good ? '#0f6b57' : '#a52218'),
      borderRadius: 10, padding: '11px 14px', fontSize: 13.5,
      margin: '0 0 18px', lineHeight: 1.5,
    }),
  };
}

export function PortalAuthShell({
  eyebrow, headline, blurb, pillars,
  title, subtitle, footnote, children,
}) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const t = authTokens(dark);

  return (
    <div className="lms-login-root" style={{ minHeight: '100vh', display: 'flex', background: t.panelBg }}>

      {/* ── Left brand panel ── */}
      <section className="lms-login-brand" style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '52px 60px', color: '#eaf0fb', position: 'relative', overflow: 'hidden',
        background: dark
          ? 'linear-gradient(158deg, #080d18 0%, #101b36 54%, #16264a 100%)'
          : 'linear-gradient(158deg, #101830 0%, #16274f 54%, #1e3a73 100%)',
      }}>
        {/* decorative glows */}
        <div aria-hidden="true" style={{
          position: 'absolute', width: 560, height: 560, borderRadius: '50%',
          top: -180, right: -160,
          background: 'radial-gradient(circle, rgba(59,130,246,.30) 0%, transparent 68%)',
        }} />
        <div aria-hidden="true" style={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          bottom: -160, left: -120,
          background: 'radial-gradient(circle, rgba(45,212,191,.16) 0%, transparent 68%)',
        }} />

        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, position: 'relative' }}>
          <img src="/mcn-logo.png" alt="MCN" style={{ height: 34, objectFit: 'contain' }} />
          <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,.20)' }} />
          <span style={{
            fontSize: 13, fontWeight: 600, letterSpacing: '.15em',
            textTransform: 'uppercase', color: 'rgba(234,240,251,.72)',
          }}>
            {eyebrow}
          </span>
        </div>

        {/* hero copy */}
        <div style={{ position: 'relative', maxWidth: 520 }}>
          <h1 className="lms-display" style={{
            fontSize: 'clamp(32px, 3.6vw, 50px)', lineHeight: 1.08,
            letterSpacing: '-.03em', fontWeight: 600,
            margin: '0 0 18px', textWrap: 'balance',
          }}>{headline}</h1>
          <p style={{
            fontSize: 16.5, lineHeight: 1.65,
            color: 'rgba(234,240,251,.70)', margin: '0 0 40px', maxWidth: 460,
          }}>{blurb}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
            {pillars.map(p => (
              <div key={p.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  display: 'grid', placeItems: 'center',
                  background: 'rgba(122,162,255,.14)',
                  border: '1px solid rgba(122,162,255,.28)',
                  color: '#9dbcff',
                }}>
                  <AuthIcon name={p.icon} size={17} />
                </span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 14.5, marginBottom: 3 }}>
                    {p.title}
                  </span>
                  <span style={{ display: 'block', fontSize: 13.5, lineHeight: 1.55, color: 'rgba(234,240,251,.58)' }}>
                    {p.desc}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ position: 'relative', fontSize: 12.5, color: 'rgba(234,240,251,.42)', margin: 0 }}>
          {footnote}
        </p>
      </section>

      {/* ── Right form panel ── */}
      <section className="lms-login-panel" style={{
        width: 460, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, position: 'relative', background: t.panelBg,
        borderLeft: dark ? '1px solid rgba(255,255,255,.07)' : '1px solid #e6eaf2',
      }}>
        {/* theme toggle */}
        <button
          type="button"
          onClick={toggle}
          className="lms-icon-btn"
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          style={{
            position: 'absolute', top: 18, right: 18, width: 40, height: 40,
            borderRadius: 10, display: 'grid', placeItems: 'center',
            cursor: 'pointer', color: t.inkSoft,
            background: 'transparent', border: '1px solid ' + t.fieldLine,
          }}
        >
          <AuthIcon name={dark ? 'sun' : 'moon'} size={17} />
        </button>

        <div style={{ width: '100%', maxWidth: 348 }}>
          <h2 className="lms-display" style={{
            color: t.ink, fontSize: 26, fontWeight: 600,
            letterSpacing: '-.02em', margin: '0 0 7px',
          }}>
            {title}
          </h2>
          <p style={{ color: t.inkSoft, fontSize: 14.5, margin: '0 0 30px', lineHeight: 1.55 }}>
            {subtitle}
          </p>

          {children(t, dark)}
        </div>
      </section>

      <style>{AUTH_CSS}</style>
    </div>
  );
}
