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
  const isAssessment = cert.certificate_type === 'ASSESSMENT';
  const certKind = isAssessment ? 'Certificate of Achievement' : 'Certificate of Completion';
  const scorePct = cert.score_pct !== null && cert.score_pct !== undefined ? Math.round(Number(cert.score_pct)) : null;
  // Donut maths: r=30, circumference=188.5, fill = score/100 * 188.5
  const dashFill = scorePct !== null ? (scorePct / 100 * 188.5).toFixed(1) : '0';
  const dashGap = (188.5 - Number(dashFill)).toFixed(1);
  const logoTag = logo ? `<img class="hlogo" src="${logo}" alt="MCN">` : '<div style="width:48px"></div>';
  const photoDataUri = employeePhotoDataUri(cert.photo_url || null);
  const initials = (cert.trainee_name || cert.employee_id || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const photoTag = photoDataUri
    ? `<img style="width:100%;height:100%;object-fit:cover;" src="${photoDataUri}" alt="${esc(cert.trainee_name || '')}">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0d3c72;font-family:Montserrat,sans-serif;font-size:28px;font-weight:900;color:#c9a84c;">${initials}</div>`;
  // Grade from score
  const grade = scorePct === null ? '' : scorePct >= 90 ? 'A+' : scorePct >= 80 ? 'A' : scorePct >= 70 ? 'B+' : scorePct >= 60 ? 'B' : 'C';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(cert.certificate_no)} - ${esc(cert.trainee_name || cert.employee_id)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800;900&family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  @page{size:A4 landscape;margin:0}
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
  body{width:297mm;height:210mm;display:flex;align-items:center;justify-content:center;
    font-family:"Inter","Segoe UI",Arial,sans-serif;background:#dde4ec;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cert{width:285mm;height:200mm;position:relative;overflow:hidden;background:#fff;
    border-radius:10px;box-shadow:0 16px 56px rgba(0,0,0,.22)}
  .hband{position:absolute;top:0;left:0;right:0;height:74px;
    background:linear-gradient(135deg,#267abd 0%,#1a5a9a 45%,#0d3c72 100%);z-index:4;overflow:hidden}
  .hcontent{position:absolute;top:0;left:0;right:0;height:74px;
    display:flex;align-items:center;padding:0 28px;z-index:5}
  .hlogo{height:48px;width:auto;object-fit:contain;filter:brightness(0) invert(1);flex-shrink:0}
  .horg{margin-left:14px}
  .horg-name{font-family:"Montserrat",sans-serif;font-size:20px;font-weight:800;color:#fff;letter-spacing:.4px}
  .horg-sub{font-size:9.5px;color:rgba(255,255,255,.72);letter-spacing:1.2px;text-transform:uppercase;margin-top:2px}
  .hcno{margin-left:auto;text-align:right}
  .hcno-label{font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.6)}
  .hcno-val{font-family:"Montserrat",monospace;font-size:12.5px;font-weight:700;color:#fff;margin-top:2px}
  .tristrip{position:absolute;top:74px;left:0;right:0;height:6px;z-index:4;
    background:linear-gradient(90deg,#267abd 0%,#267abd 33.3%,#76c053 33.3%,#76c053 66.6%,#dc363a 66.6%,#dc363a 100%)}
  .lpanel{position:absolute;top:80px;left:0;bottom:0;width:196px;
    background:linear-gradient(180deg,#f3f8fd 0%,#e8f2fb 100%);
    border-right:1px solid #cce0f5;
    display:flex;flex-direction:column;align-items:center;padding:16px 12px 12px}
  .grad-card{width:132px;background:#fff;border-radius:12px;
    box-shadow:0 4px 16px rgba(38,122,189,.18);padding:10px 8px 8px;text-align:center;
    border:1.5px solid #cce0f5;margin-bottom:12px}
  .grad-title{font-size:8.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#267abd;margin-bottom:6px}
  .stat-row{display:flex;gap:6px;width:100%;margin-bottom:10px}
  .stat-box{flex:1;background:#fff;border-radius:8px;padding:7px 4px;text-align:center;
    border:1px solid #e0eef7;box-shadow:0 2px 6px rgba(38,122,189,.1)}
  .sv{font-family:"Montserrat",sans-serif;font-size:16px;font-weight:900}
  .sl{font-size:7.5px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;margin-top:1px}
  .sv.blue{color:#267abd}.sv.green{color:#76c053}.sv.red{color:#dc363a}
  .vbadge{width:100%;padding:6px 0;border-radius:8px;text-align:center;
    background:linear-gradient(135deg,#76c053,#4a9930);color:#fff;
    font-size:9.5px;font-weight:800;letter-spacing:2px;text-transform:uppercase;
    box-shadow:0 3px 10px rgba(118,192,83,.35);margin-bottom:10px}
  .ldiv{width:85%;height:1.5px;background:linear-gradient(90deg,transparent,#cce0f5,transparent);margin:8px 0}
  .eid-box{width:100%;background:#fff;border-radius:8px;padding:7px 10px;
    border:1px solid #cce0f5;text-align:center}
  .eid-lbl{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:#9ca3af}
  .eid-val{font-family:"Montserrat",sans-serif;font-size:13px;font-weight:800;color:#267abd;margin-top:2px}
  .rmain{position:absolute;top:80px;left:196px;right:0;bottom:0;padding:18px 28px 12px 22px;display:flex;flex-direction:column}
  .ckind{font-size:9.5px;letter-spacing:5px;text-transform:uppercase;color:#267abd;font-weight:700;margin-bottom:5px}
  .ctitle{font-family:"Playfair Display",Georgia,serif;font-size:21px;font-weight:700;
    color:#0d3c72;margin-bottom:10px;line-height:1.25;max-width:490px}
  .presented{font-size:11px;color:#6b7280;font-style:italic;margin-bottom:3px}
  .tname{font-family:"Playfair Display",Georgia,serif;font-size:32px;font-weight:900;
    color:#0d3c72;margin:2px 0 6px;line-height:1.1}
  .name-ul{width:300px;height:3px;border-radius:2px;margin-bottom:12px;
    background:linear-gradient(90deg,#267abd 33%,#76c053 33% 66%,#dc363a 66%)}
  .detail{font-size:12px;color:#374151;line-height:1.9}
  .detail b{color:#0d3c72;font-weight:600}
  .badge-row{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center}
  .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 16px;border-radius:22px;
    font-family:"Montserrat",sans-serif;font-size:11.5px;font-weight:800;letter-spacing:.3px}
  .badge.primary{background:linear-gradient(135deg,#267abd,#0d3c72);color:#fff;
    box-shadow:0 4px 12px rgba(38,122,189,.38)}
  .badge.green{background:linear-gradient(135deg,#76c053,#4a9930);color:#fff;
    box-shadow:0 4px 12px rgba(118,192,83,.35)}
  .bdot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.7)}
  .stars{font-size:15px;color:#76c053;letter-spacing:3px;margin-top:5px}
  .seal{position:absolute;right:22px;bottom:32px;width:76px;height:76px;border-radius:50%;
    background:radial-gradient(circle,#fff 55%,#f0f8ff 100%);
    border:2.5px solid #267abd;outline:4px solid rgba(38,122,189,.16);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    box-shadow:0 4px 14px rgba(38,122,189,.22)}
  .seal-icon{font-size:20px;line-height:1}
  .seal-text{font-size:7px;font-weight:800;color:#267abd;letter-spacing:.5px;text-transform:uppercase;line-height:1.4;text-align:center;margin-top:2px}
  .seal-year{font-size:10.5px;font-weight:900;color:#dc363a}
  .footer{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;
    border-top:1px solid #e5e7eb;padding-top:8px}
  .fm{font-size:8.5px;color:#9ca3af;line-height:1.9}.fm b{color:#374151}
  .sig-block{text-align:center}
  .sig-line{width:150px;height:1px;background:#c4c9d4;margin:0 auto 4px}
  .sig-label{font-size:8.5px;color:#6b7280;letter-spacing:.5px}
  .fv{font-size:8.5px;color:#9ca3af;text-align:right;line-height:1.9}.fv b{color:#374151}
  .gem{position:absolute;width:14px;height:14px;
    clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%);
    background:linear-gradient(135deg,#267abd,#76c053)}
  .gem.tl{top:82px;left:6px}.gem.tr{top:82px;right:6px}
  .gem.bl{bottom:6px;left:6px}.gem.br{bottom:6px;right:6px}
  @media print{body{background:#fff}.cert{box-shadow:none}}
</style></head><body>
<div class="cert">
<div class="hband">
  <svg style="position:absolute;right:0;top:0;height:100%;opacity:.1" viewBox="0 0 300 74" width="300" height="74">
    <g fill="white">
      <polygon points="20,5 35,14 35,32 20,41 5,32 5,14"/><polygon points="60,5 75,14 75,32 60,41 45,32 45,14"/>
      <polygon points="100,5 115,14 115,32 100,41 85,32 85,14"/><polygon points="140,5 155,14 155,32 140,41 125,32 125,14"/>
      <polygon points="180,5 195,14 195,32 180,41 165,32 165,14"/><polygon points="220,5 235,14 235,32 220,41 205,32 205,14"/>
      <polygon points="260,5 275,14 275,32 260,41 245,32 245,14"/>
      <polygon points="40,32 55,41 55,59 40,68 25,59 25,41"/><polygon points="80,32 95,41 95,59 80,68 65,59 65,41"/>
      <polygon points="120,32 135,41 135,59 120,68 105,59 105,41"/><polygon points="160,32 175,41 175,59 160,68 145,59 145,41"/>
      <polygon points="200,32 215,41 215,59 200,68 185,59 185,41"/><polygon points="240,32 255,41 255,59 240,68 225,59 225,41"/>
    </g>
  </svg>
</div>
<div class="hcontent">
  ${logoTag}
  <div class="horg">
    <div class="horg-name">MAS Callnet</div>
    <div class="horg-sub">Training &amp; Quality &middot; Learning Management System</div>
  </div>
  <div class="hcno">
    <div class="hcno-label">Certificate No</div>
    <div class="hcno-val">${esc(cert.certificate_no)}</div>
  </div>
</div>
<div class="tristrip"></div>
<div class="lpanel">
  <div class="grad-card">
    <div class="grad-title">Achievement</div>
    <svg width="88" height="88" viewBox="0 0 90 90" fill="none" style="display:block;margin:0 auto">
      <circle cx="45" cy="45" r="43" fill="#edf4ff" stroke="#cce0f5" stroke-width="1.5"/>
      <ellipse cx="45" cy="28" rx="22" ry="6" fill="#267abd"/>
      <polygon points="45,16 23,28 45,36 67,28" fill="#1a5e99"/>
      <rect x="60" y="28" width="3" height="13" rx="1.5" fill="#dc363a"/>
      <circle cx="61.5" cy="42" r="3.5" fill="#dc363a"/>
      <circle cx="45" cy="50" r="10" fill="#fde8d0" stroke="#f5c5a0" stroke-width="1"/>
      <path d="M27,78 Q28,60 45,62 Q62,60 63,78" fill="#267abd"/>
      <path d="M31,64 L24,82 L33,76 Z M59,64 L66,82 L57,76 Z" fill="#1a5e99"/>
      <rect x="37" y="68" width="16" height="10" rx="2.5" fill="#fffde7" stroke="#267abd" stroke-width="1.5"/>
      <line x1="39" y1="72" x2="51" y2="72" stroke="#267abd" stroke-width="1.2" opacity=".6"/>
      <line x1="39" y1="75" x2="49" y2="75" stroke="#267abd" stroke-width="1.2" opacity=".6"/>
      <text x="14" y="24" font-size="10" fill="#76c053" opacity=".8">&#9733;</text>
      <text x="68" y="22" font-size="8" fill="#dc363a" opacity=".7">&#9733;</text>
    </svg>
  </div>
  <div class="stat-row">
    <div class="stat-box">
      <div class="sv blue">${scorePct !== null ? scorePct : '—'}</div>
      <div class="sl">Score%</div>
    </div>
    <div class="stat-box">
      <div class="sv green">${grade || '—'}</div>
      <div class="sl">Grade</div>
    </div>
  </div>
  <svg width="78" height="78" viewBox="0 0 80 80" style="margin-bottom:8px">
    <circle cx="40" cy="40" r="30" fill="none" stroke="#e5e7eb" stroke-width="9"/>
    <circle cx="40" cy="40" r="30" fill="none" stroke="#267abd" stroke-width="9"
      stroke-dasharray="${dashFill} ${dashGap}" stroke-dashoffset="47.1" stroke-linecap="round"
      transform="rotate(-90 40 40)"/>
    <text x="40" y="45" text-anchor="middle" font-size="14" font-weight="900" fill="#267abd" font-family="Montserrat,sans-serif">${scorePct !== null ? scorePct + '%' : '—'}</text>
  </svg>
  <div class="vbadge">&#10003; CERTIFIED</div>
  <div class="ldiv"></div>
  <div class="eid-box">
    <div class="eid-lbl">Employee ID</div>
    <div class="eid-val">${esc(cert.employee_id)}</div>
  </div>
</div>
<div class="rmain">
  <div class="ckind">&#127941; &nbsp; ${certKind}</div>
  <div class="ctitle">${esc(cert.title)}</div>
  <div class="presented">This is to proudly certify that</div>
  <div class="tname">${esc(cert.trainee_name || cert.employee_id)}</div>
  <div class="name-ul"></div>
  <div class="detail">
    ${isAssessment ? 'has successfully passed the assessment named above' : 'has successfully completed all required modules, assessments &amp; evaluations'}<br>
    ${cert.process ? `Process: <b>${esc(cert.process)}</b>` : ''}${cert.lob ? ` &nbsp;&middot;&nbsp; LOB: <b>${esc(cert.lob)}</b>` : ''}
    ${cert.batch_no ? `&nbsp;&middot;&nbsp; Batch: <b>${esc(cert.batch_no)}</b>` : ''}
  </div>
  <div class="badge-row">
    ${scorePct !== null ? `<div class="badge primary"><span class="bdot"></span> Score: ${scorePct}% &nbsp;&middot;&nbsp; ${scorePct >= 90 ? 'Outstanding' : scorePct >= 80 ? 'Excellent' : scorePct >= 70 ? 'Good' : 'Completed'}</div>` : ''}
    <div class="badge green"><span class="bdot"></span> Ops Ready</div>
  </div>
  <div class="stars">&#9733;&#9733;&#9733;&#9733;&#9734;</div>
  <div class="seal">
    <div class="seal-icon">&#127941;</div>
    <div class="seal-text">T&amp;Q<br>VERIFIED</div>
    <div class="seal-year">${new Date(cert.issued_at || Date.now()).getFullYear()}</div>
  </div>
  <div class="footer">
    <div class="fm">
      <div>Issued: <b>${esc(issued)}</b></div>
      <div>Code: <b>${esc(cert.verification_code)}</b></div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-label">Training &amp; Quality, MAS Callnet</div>
    </div>
    <div class="fv">
      ${verifyUrl ? `<div>Verify: <b>${esc(verifyUrl)}</b></div>` : ''}
      <div><b>mcnlms.teammas.in</b></div>
    </div>
  </div>
</div>
<div class="gem tl"></div><div class="gem tr"></div>
<div class="gem bl"></div><div class="gem br"></div>
</div></body></html>`;
}
