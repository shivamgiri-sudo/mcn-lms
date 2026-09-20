import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { prisma } from '../utils/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The certificate HTML is written into an about:blank window, so a relative
// /mcn-logo.png would resolve against that blank document and render nothing. The
// logo is inlined as a data URI instead, read once and cached.
let cachedLogo;
function logoDataUri() {
  if (cachedLogo !== undefined) return cachedLogo;
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'frontend', 'dist', 'mcn-logo.png'),
    path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'mcn-logo.png'),
    path.resolve(__dirname, '..', '..', '..', 'mcn-logo.png'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        cachedLogo = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
        return cachedLogo;
      }
    } catch { /* try the next location */ }
  }
  cachedLogo = null;
  return cachedLogo;
}


import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const HRMS_UPLOADS = resolve('/var/www/HRMS2/backend/uploads');

function employeePhotoDataUri(photoUrl) {
  if (!photoUrl) return null;
  try {
    // photoUrl is like /api/files/employee-photos/<uuid>.jpg
    const filename = photoUrl.split('/').pop();
    if (!filename) return null;
    const filePath = resolve(HRMS_UPLOADS, 'employee-photos', filename);
    if (!existsSync(filePath)) return null;
    const data = readFileSync(filePath);
    const ext = filename.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function ensureCertificateTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS certificate_issue (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      certificate_no VARCHAR(64) NOT NULL UNIQUE,
      verification_code VARCHAR(32) NOT NULL UNIQUE,
      employee_id VARCHAR(191) NOT NULL,
      certificate_type VARCHAR(30) NOT NULL DEFAULT 'TRAINING',
      reference_id VARCHAR(191) NULL,
      title VARCHAR(255) NOT NULL,
      trainee_name VARCHAR(255) NULL,
      batch_no VARCHAR(191) NULL,
      process VARCHAR(255) NULL,
      lob VARCHAR(255) NULL,
      score_pct DOUBLE NULL,
      issued_by VARCHAR(191) NULL,
      issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      revoked_at DATETIME(3) NULL,
      UNIQUE KEY uq_cert_identity (employee_id, certificate_type, reference_id),
      INDEX idx_cert_employee (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function sequenceFrom(row) {
  const value = Number(row?.n ?? row?.N ?? 0);
  return Number.isFinite(value) ? value : 0;
}

// A certificate number has to survive reissue, so it is allocated once and stored.
// The old page built one from Date.now(), which changed on every open and could
// therefore never be verified or matched to a printed copy.
async function nextCertificateNo(kind) {
  const year = new Date().getFullYear();
  const prefix = `MCN-${kind}-${year}-`;
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS n FROM certificate_issue WHERE certificate_no LIKE ?', `${prefix}%`,
  );
  return `${prefix}${String(sequenceFrom(row) + 1).padStart(5, '0')}`;
}

// Get-or-create: opening the same certificate twice returns the same number rather
// than issuing a new one.
export async function issueCertificate({
  employeeId, certificateType = 'TRAINING', referenceId = null,
  title, traineeName, batchNo = null, process = null, lob = null, scorePct = null, issuedBy = null,
}) {
  await ensureCertificateTable();
  const existing = await prisma.$queryRawUnsafe(
    `SELECT * FROM certificate_issue
      WHERE employee_id = ? AND certificate_type = ? AND ${referenceId === null ? 'reference_id IS NULL' : 'reference_id = ?'}
      LIMIT 1`,
    ...(referenceId === null ? [employeeId, certificateType] : [employeeId, certificateType, referenceId]),
  );
  if (existing?.[0]) return existing[0];

  const kind = certificateType === 'ASSESSMENT' ? 'ASM' : 'TRN';
  const certificateNo = await nextCertificateNo(kind);
  const verificationCode = randomBytes(6).toString('hex').toUpperCase();
  await prisma.$executeRawUnsafe(
    `INSERT INTO certificate_issue
       (id, certificate_no, verification_code, employee_id, certificate_type, reference_id,
        title, trainee_name, batch_no, process, lob, score_pct, issued_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    certificateNo, verificationCode, employeeId, certificateType, referenceId,
    title, traineeName, batchNo, process, lob, scorePct, issuedBy,
  );
  const [created] = await prisma.$queryRawUnsafe(
    'SELECT * FROM certificate_issue WHERE certificate_no = ?', certificateNo,
  );
  return created;
}

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderCertificateHtml(cert, { verifyUrl = '' } = {}) {
  const logo = logoDataUri();
  const issued = new Date(cert.issued_at || Date.now())
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const issueYear = new Date(cert.issued_at || Date.now()).getFullYear();
  const isAssessment = cert.certificate_type === 'ASSESSMENT';
  const scorePct = cert.score_pct != null ? Math.round(Number(cert.score_pct)) : null;
  const grade = scorePct == null ? null : scorePct >= 90 ? 'A+' : scorePct >= 80 ? 'A' : scorePct >= 70 ? 'B+' : scorePct >= 60 ? 'B' : 'C';
  const perf = scorePct == null ? '' : scorePct >= 90 ? 'Outstanding' : scorePct >= 80 ? 'Excellent' : scorePct >= 70 ? 'Good' : 'Completed';
  const dashFill = scorePct != null ? (scorePct / 100 * 188.5).toFixed(1) : '0';
  const dashGap  = (188.5 - Number(dashFill)).toFixed(1);
  const logoTag  = logo ? `<img class="hlogo" src="${logo}" alt="MCN">` : '<div style="width:50px"></div>';
  const photoDataUri = employeePhotoDataUri(cert.photo_url || null);
  const initials = (cert.trainee_name || cert.employee_id || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const photoContent = photoDataUri
    ? `<img src="${photoDataUri}" style="width:100%;height:100%;object-fit:cover;display:block" alt="${esc(cert.trainee_name || '')}">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0d3c72;font-family:Montserrat,sans-serif;font-size:28px;font-weight:900;color:#c9a84c">${initials}</div>`;
  const doj = cert.doj ? new Date(cert.doj).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
  const certKind = isAssessment ? 'ACHIEVEMENT' : 'COMPLETION';
  // Build dynamic score tiles from actual evidence — only what was actually assessed
  const scoreBlocks = (() => {
    const tiles = [];
    if (cert.course_pct != null) tiles.push({ lbl:'Course', val:Math.round(Number(cert.course_pct)), cls:'blue', color:'#267abd', sub:'Completed' });
    if (cert.mcq_pct != null) tiles.push({ lbl:'MCQ Score', val:Math.round(Number(cert.mcq_pct)), cls:'green', color:'#16a34a', sub:'Tests passed' });
    if (cert.attendance_pct != null) {
      const present = cert.attendance_present || '—';
      const total   = cert.attendance_total || '—';
      tiles.push({ lbl:'Attendance', val:Math.round(Number(cert.attendance_pct)), cls:'blue', color:'#267abd', sub:`${present} / ${total} days` });
    }
    (cert.evidence || []).forEach(ev => {
      if (ev.scorePct == null) return;
      const lbl = String(ev.label || ev.evidenceType || 'Assessment').replace(/_/g,' ');
      tiles.push({ lbl: lbl.length > 13 ? lbl.slice(0,12)+'…' : lbl, val:Math.round(Number(ev.scorePct)), cls:'red', color:'#dc363a', sub: ev.result || '' });
    });
    if (scorePct != null) tiles.push({ lbl:'Final Score', val:scorePct, cls:'gold', color:'linear-gradient(90deg,#c9a84c,#e8b84b)', sub:`Grade: ${grade}` });
    return tiles.map(t =>
      `<div class="sd-item ${t.cls}">
        <span class="sd-label">${esc(t.lbl)}</span>
        <span class="sd-val ${t.cls}">${t.val}%</span>
        <div class="sd-bar"><div class="sd-fill" style="width:${t.val}%;background:${t.color}"></div></div>
        <span class="sd-sub">${esc(t.sub)}</span>
      </div>`
    ).join('');
  })();

  const department = esc(cert.department || cert.lob || '—');
  const process_   = esc(cert.process || '—');
  const branch_    = esc(cert.branch || '—');
  const empId_     = esc(cert.employee_id || '—');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(cert.certificate_no)} — ${esc(cert.trainee_name || cert.employee_id)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=Montserrat:wght@400;600;700;800;900&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
@page{size:A4 landscape;margin:0}
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{min-height:100vh;width:100%;background-color:#04091a;
  background-image:radial-gradient(circle,rgba(38,122,189,.15) 1px,transparent 1px),radial-gradient(ellipse 70% 55% at 15% 40%,rgba(38,122,189,.5) 0%,transparent 70%),radial-gradient(ellipse 55% 45% at 88% 15%,rgba(118,192,83,.4) 0%,transparent 65%),radial-gradient(ellipse 45% 40% at 75% 85%,rgba(220,54,58,.35) 0%,transparent 60%),radial-gradient(ellipse 60% 50% at 50% 50%,rgba(15,60,114,.55) 0%,transparent 70%);
  background-size:28px 28px,100% 100%,100% 100%,100% 100%,100% 100%;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
body{width:297mm;height:210mm;display:flex;align-items:center;justify-content:center;background:transparent;margin:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cert{width:285mm;height:200mm;position:relative;overflow:hidden;background:#fff;border-radius:4px;box-shadow:0 0 0 1.5px rgba(38,122,189,.35),0 0 60px rgba(38,122,189,.3),0 32px 80px rgba(0,0,0,.6)}
.frame-out{position:absolute;inset:5px;border:3px solid #0d3c72;z-index:12;pointer-events:none;border-radius:2px}
.frame-in{position:absolute;inset:10px;border:1px solid #c9a84c;z-index:12;pointer-events:none;border-radius:1px}
.cpanel{position:absolute;width:88px;height:88px;z-index:13;overflow:visible;pointer-events:none}
.cpanel.tl{top:5px;left:5px}.cpanel.tr{top:5px;right:5px;transform:scaleX(-1)}.cpanel.bl{bottom:5px;left:5px;transform:scaleY(-1)}.cpanel.br{bottom:5px;right:5px;transform:scale(-1,-1)}
.hband{position:absolute;top:0;left:0;right:0;height:78px;background:#fff;border-bottom:2px solid #f0f4f8;z-index:4;overflow:hidden}
.hband::after{content:'';position:absolute;right:0;top:0;bottom:0;width:250px;background:linear-gradient(135deg,transparent 20%,#f0f7ff 100%)}
.hdots{position:absolute;right:10px;top:50%;transform:translateY(-50%);opacity:.07}
.hcontent{position:absolute;top:0;left:0;right:0;height:78px;display:flex;align-items:center;padding:0 24px 0 100px;z-index:14;gap:14px}
.hlogo{height:50px;width:auto;object-fit:contain;flex-shrink:0}
.hdiv{width:2px;height:38px;background:linear-gradient(180deg,#267abd,#76c053);flex-shrink:0;border-radius:1px}
.horg-name{font-family:"Montserrat",sans-serif;font-size:19px;font-weight:900;color:#0d3c72;letter-spacing:.3px}
.horg-sub{font-size:9.5px;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-top:2px;font-weight:500}
.hcno{margin-left:auto;text-align:right;padding-right:68px}
.hcno-lbl{font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;font-weight:600}
.hcno-val{font-family:"Montserrat",monospace;font-size:12.5px;font-weight:800;color:#267abd;margin-top:3px}
.tristrip{position:absolute;top:78px;left:0;right:0;height:5px;z-index:4;background:linear-gradient(90deg,#267abd 0% 33.3%,#76c053 33.3% 66.6%,#dc363a 66.6% 100%)}
.lpanel{position:absolute;top:83px;left:0;bottom:0;width:192px;background:linear-gradient(180deg,#f5f9ff 0%,#e8f2fc 100%);border-right:1.5px solid #d6e8f8;display:flex;flex-direction:column;align-items:center;padding:14px 12px 12px}
.lphoto-wrap{width:132px;height:132px;border-radius:12px;overflow:hidden;flex-shrink:0;margin-bottom:8px;border:3px solid #c9a84c;outline:3px solid rgba(201,168,76,.2);box-shadow:0 6px 20px rgba(13,60,114,.22)}
.lphoto-name{font-family:"Montserrat",sans-serif;font-size:10.5px;font-weight:800;color:#0d3c72;text-align:center;margin-bottom:8px;line-height:1.3;max-width:160px}
.stat-row{display:flex;gap:6px;width:100%;margin-bottom:8px}
.stat-box{flex:1;background:#fff;border-radius:8px;padding:7px 4px;text-align:center;border:1.5px solid #e0eef7}
.sv{font-family:"Montserrat",sans-serif;font-size:19px;font-weight:900}
.sl{font-size:8px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-top:1px;font-weight:600}
.sv.blue{color:#267abd}.sv.green{color:#76c053}
.vbadge{width:100%;padding:7px 0;border-radius:9px;text-align:center;background:linear-gradient(135deg,#76c053,#4a9930);color:#fff;font-size:10px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}
.ldiv{width:85%;height:1.5px;background:linear-gradient(90deg,transparent,#cce0f5,transparent);margin:4px 0}
.eid-box{width:100%;background:#fff;border-radius:8px;padding:7px 8px;border:1.5px solid #d6e8f8;text-align:center}
.eid-lbl{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af;font-weight:600}
.eid-val{font-family:"Montserrat",sans-serif;font-size:14px;font-weight:900;color:#267abd;margin-top:2px}
.rmain{position:absolute;top:83px;left:192px;right:0;bottom:36px;padding:0 20px;display:flex;flex-direction:column;align-items:center;justify-content:space-evenly;text-align:center}
.cert-big{font-family:"Cinzel",serif;font-size:44px;font-weight:900;color:#0d3c72;letter-spacing:10px;text-indent:10px;line-height:1}
.cert-rule-row{display:flex;align-items:center;gap:12px;width:100%;margin-top:4px}
.crule{flex:1;height:1.5px;background:linear-gradient(90deg,transparent,#c9a84c)}
.crule.r{background:linear-gradient(90deg,#c9a84c,transparent)}
.cert-of{font-family:"Cinzel",serif;font-size:13px;font-weight:600;color:#0d3c72;letter-spacing:7px;text-indent:7px;white-space:nowrap}
.presented{display:block;font-size:11.5px;color:#6b7280;font-style:italic;font-family:"Playfair Display",serif;margin-bottom:4px}
.tname{font-family:"Playfair Display",Georgia,serif;font-size:46px;font-weight:900;color:#0d3c72;line-height:1.05;letter-spacing:.2px;margin-bottom:5px}
.name-ul{width:360px;height:4px;border-radius:2px;margin:0 auto;background:linear-gradient(90deg,#267abd 33%,#76c053 33% 66%,#dc363a 66%)}
.ctitle{font-family:"Poppins",sans-serif;font-size:14.5px;font-weight:700;color:#0d3c72;line-height:1.35;margin-bottom:5px}
.cert-stmt{font-size:12px;color:#4b5563;line-height:1.75;font-family:"Poppins",sans-serif;font-weight:400}
.cert-stmt b{color:#0d3c72;font-weight:700}
.fields{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 7px;width:100%}
.fi{background:#f0f6ff;border:1.5px solid #cce0f5;border-radius:9px;padding:7px 8px;text-align:center}
.fl{display:block;font-size:8px;letter-spacing:.9px;text-transform:uppercase;color:#9ca3af;margin-bottom:3px;font-weight:700}
.fv2{font-size:13.5px;font-weight:800;color:#0d3c72;font-family:"Poppins",sans-serif}
.score-detail{display:flex;gap:6px;width:100%}
.sd-item{flex:1;border-radius:9px;padding:8px 4px 7px;text-align:center;border:1.5px solid transparent}
.sd-item.blue{background:#edf4ff;border-color:#bfdbfe}.sd-item.green{background:#eaf8ef;border-color:#bbf7d0}
.sd-item.red{background:#fff0f1;border-color:#fecdd3}.sd-item.gold{background:#fffbeb;border-color:#fde68a}
.sd-label{display:block;font-size:8.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;margin-bottom:3px}
.sd-item.blue .sd-label{color:#1d4ed8}.sd-item.green .sd-label{color:#15803d}.sd-item.red .sd-label{color:#dc2626}.sd-item.gold .sd-label{color:#b45309}
.sd-val{display:block;font-family:"Montserrat",sans-serif;font-size:22px;font-weight:900;line-height:1}
.sd-val.blue{color:#267abd}.sd-val.green{color:#16a34a}.sd-val.red{color:#dc363a}.sd-val.gold{color:#d97706}
.sd-bar{width:70%;height:3px;background:rgba(0,0,0,.08);border-radius:2px;margin:4px auto 3px;overflow:hidden}
.sd-fill{height:100%;border-radius:2px}
.sd-sub{display:block;font-size:8.5px;color:#6b7280;font-weight:600}
.fbar{position:absolute;bottom:0;left:192px;right:0;height:36px;background:#f0f6ff;border-top:1.5px solid #d6e8f8;display:flex;align-items:center;justify-content:center;gap:6px;z-index:6}
.fbar-certno{font-family:"Montserrat",monospace;font-size:9.5px;font-weight:800;color:#0d3c72;letter-spacing:2px}
.fbar-sep{color:#d6e8f8;font-size:14px}
.fbar-verify{font-size:8px;color:#9ca3af;letter-spacing:1px;font-family:"Poppins",sans-serif}
@media print{body{background:#fff!important}html{background:#fff!important}.cert{box-shadow:none}}
</style></head><body>
<div class="cert">
<div class="frame-out"></div><div class="frame-in"></div>
${['tl','tr','bl','br'].map(pos => `<div class="cpanel ${pos}"><svg width="88" height="88" viewBox="0 0 88 88" fill="none"><polygon points="0,0 88,0 0,88" fill="#0d3c72" opacity=".9"/><line x1="12" y1="0" x2="0" y2="12" stroke="#c9a84c" stroke-width="2.5"/><line x1="24" y1="0" x2="0" y2="24" stroke="#c9a84c" stroke-width="1.2" opacity=".7"/><line x1="38" y1="0" x2="0" y2="38" stroke="#c9a84c" stroke-width="1" opacity=".45"/><line x1="54" y1="0" x2="0" y2="54" stroke="#c9a84c" stroke-width=".8" opacity=".3"/><rect x="5" y="5" width="14" height="14" fill="none" stroke="#c9a84c" stroke-width="1.5"/><rect x="9" y="9" width="6" height="6" fill="#c9a84c" opacity=".45"/></svg></div>`).join('')}
<div class="hband"><svg class="hdots" viewBox="0 0 200 60" width="200" height="60"><g fill="#267abd">${Array.from({length:30},(_,i)=>`<circle cx="${(i%10)*20+10}" cy="${Math.floor(i/10)*20+10}" r="2.5"/>`).join('')}</g></svg></div>
<div class="hcontent">
  ${logoTag}
  <div class="hdiv"></div>
  <div><div class="horg-name">MAS Callnet Pvt. Ltd.</div><div class="horg-sub">Training &amp; Quality &middot; Learning Management System</div></div>
  <div class="hcno"><div class="hcno-lbl">Certificate No</div><div class="hcno-val">${esc(cert.certificate_no)}</div></div>
</div>
<div class="tristrip"></div>
<div class="lpanel">
  <div class="lphoto-wrap">${photoContent}</div>
  <div class="lphoto-name">${esc(cert.trainee_name || cert.employee_id)}</div>
  <div class="stat-row">
    <div class="stat-box"><div class="sv blue">${scorePct ?? '—'}</div><div class="sl">Score%</div></div>
    <div class="stat-box"><div class="sv green">${grade ?? '—'}</div><div class="sl">Grade</div></div>
  </div>
  <svg width="76" height="76" viewBox="0 0 80 80" style="margin-bottom:8px">
    <circle cx="40" cy="40" r="30" fill="none" stroke="#e5e7eb" stroke-width="8"/>
    <circle cx="40" cy="40" r="30" fill="none" stroke="#267abd" stroke-width="8"
      stroke-dasharray="${dashFill} ${dashGap}" stroke-dashoffset="47.1" stroke-linecap="round"
      transform="rotate(-90 40 40)"/>
    <text x="40" y="45" text-anchor="middle" font-size="14" font-weight="900" fill="#267abd" font-family="Montserrat,sans-serif">${scorePct != null ? scorePct + '%' : '—'}</text>
  </svg>
  <div class="vbadge">&#10003; CERTIFIED</div>
  <div class="ldiv"></div>
  <div class="eid-box"><div class="eid-lbl">Employee ID</div><div class="eid-val">${empId_}</div></div>
</div>
<div class="rmain">
  <div style="width:100%">
    <div class="cert-big">CERTIFICATE</div>
    <div class="cert-rule-row"><div class="crule"></div><div class="cert-of">OF ${certKind}</div><div class="crule r"></div></div>
  </div>
  <div style="width:100%">
    <span class="presented">This certificate is proudly presented to</span>
    <div class="tname">${esc(cert.trainee_name || cert.employee_id)}</div>
    <div class="name-ul"></div>
  </div>
  <div style="width:100%">
    <div class="ctitle">${esc(cert.title)}</div>
    <div class="cert-stmt">has successfully completed all required training modules, knowledge assessments,
    practical evaluations &amp; process quality checks and is hereby declared
    <b>Operations Ready</b> by <b>MAS Callnet Pvt. Ltd.</b></div>
  </div>
  <div class="fields">
    <div class="fi"><span class="fl">Department</span><span class="fv2">${department}</span></div>
    <div class="fi"><span class="fl">Process</span><span class="fv2">${process_}</span></div>
    <div class="fi"><span class="fl">Branch</span><span class="fv2">${branch_}</span></div>
    <div class="fi"><span class="fl">Date of Joining</span><span class="fv2">${doj}</span></div>
    <div class="fi"><span class="fl">Issue Date</span><span class="fv2">${esc(issued)}</span></div>
    <div class="fi"><span class="fl">LOB</span><span class="fv2">${esc(cert.lob || '—')}</span></div>
  </div>
  <div class="score-detail">${scoreBlocks || `<div class="sd-item blue" style="flex:1"><span class="sd-label">Final Score</span><span class="sd-val blue">${scorePct != null ? scorePct + '%' : '—'}</span></div>`}</div>
</div>
<div class="fbar">
  <span class="fbar-certno">${esc(cert.certificate_no)}</span>
  <span class="fbar-sep">|</span>
  <span class="fbar-verify">VERIFY: ${verifyUrl || 'mcnlms.teammas.in/verify'} &nbsp;&middot;&nbsp; CODE: ${esc(cert.verification_code)}</span>
</div>
</div></body></html>`;
}
