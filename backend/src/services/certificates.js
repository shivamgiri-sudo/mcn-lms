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
  const accentGold = '#c9a84c';
  const accentNavy = '#0f2347';

  const logoTag = logo ? `<img src="${logo}" alt="MCN" style="height:50px;width:auto;object-fit:contain;">` : '<div style="width:50px;height:50px;"></div>';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(cert.certificate_no)} - ${esc(cert.trainee_name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 297mm; height: 210mm; display: flex; align-items: center; justify-content: center;
    font-family: 'Inter', 'Segoe UI', Arial, sans-serif; background: #f0f4f8;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cert { width: 281mm; height: 196mm; background: #fff; border-radius: 8px; position: relative;
    overflow: hidden; box-shadow: 0 12px 48px rgba(0,0,0,.18); }
  .cert::before { content: ''; position: absolute; inset: 10px; border: 1.5px solid ${accentGold};
    border-radius: 4px; pointer-events: none; z-index: 10; }
  .ribbon { position: absolute; left: 0; top: 0; bottom: 0; width: 56px;
    background: linear-gradient(180deg, #1a3a6b 0%, ${accentNavy} 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; }
  .ribbon-text { font-size: 9.5px; font-weight: 700; letter-spacing: 4px; color: ${accentGold};
    text-transform: uppercase; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
  .ribbon-line { width: 1px; height: 36px; background: rgba(201,168,76,.4); margin: 8px 0; }
  .content { margin-left: 56px; padding: 24px 42px 18px 32px; height: 100%; display: flex; flex-direction: column; position: relative; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .org-block { display: flex; align-items: center; gap: 14px; }
  .logo-wrap { width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, #1a3a6b, ${accentNavy});
    display: flex; align-items: center; justify-content: center; border: 2px solid ${accentGold}; overflow: hidden; flex-shrink: 0; }
  .org-name { font-size: 19px; font-weight: 800; color: ${accentNavy}; letter-spacing: .5px; }
  .org-sub { font-size: 10px; color: #6b7280; letter-spacing: .3px; margin-top: 1px; }
  .cert-no-block { text-align: right; }
  .cert-no-label { font-size: 8.5px; letter-spacing: 2px; text-transform: uppercase; color: #9ca3af; }
  .cert-no { font-size: 12.5px; font-weight: 700; color: ${accentNavy}; font-family: 'Courier New', monospace; margin-top: 2px; }
  .divider { height: 1px; background: linear-gradient(90deg, transparent, ${accentGold} 20%, ${accentGold} 80%, transparent); margin-bottom: 13px; }
  .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative; }
  .watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: 'Playfair Display', Georgia, serif; font-size: 120px; font-weight: 900;
    color: rgba(26,58,107,.03); pointer-events: none; user-select: none; letter-spacing: 8px; }
  .cert-kind { font-size: 10px; letter-spacing: 5px; text-transform: uppercase; color: ${accentGold}; font-weight: 700; margin-bottom: 5px; }
  .cert-title { font-family: 'Playfair Display', Georgia, serif; font-size: 25px; font-weight: 700;
    color: ${accentNavy}; margin-bottom: 14px; line-height: 1.2; max-width: 500px; }
  .presented { font-size: 11.5px; color: #6b7280; font-style: italic; margin-bottom: 3px; }
  .trainee-name { font-family: 'Playfair Display', Georgia, serif; font-size: 36px; font-weight: 900;
    color: ${accentNavy}; margin: 2px 0 12px; line-height: 1.1; }
  .detail-row { font-size: 12px; color: #374151; line-height: 2; }
  .detail-row b { color: ${accentNavy}; font-weight: 600; }
  .score-badge { display: inline-block; margin-top: 10px; padding: 4px 22px; border-radius: 20px;
    background: linear-gradient(135deg, #1a3a6b, ${accentNavy}); color: ${accentGold};
    font-size: 13px; font-weight: 700; letter-spacing: 1px; }
  .seal { position: absolute; bottom: 44px; right: 0; width: 84px; height: 84px; border-radius: 50%;
    border: 2px solid ${accentGold}; outline: 4px solid rgba(201,168,76,.2);
    display: flex; align-items: center; justify-content: center; flex-direction: column;
    background: radial-gradient(circle, #fff 60%, #fdfbf0 100%); }
  .seal-inner { font-size: 8px; font-weight: 800; color: ${accentNavy}; line-height: 1.5; letter-spacing: .5px; text-transform: uppercase; }
  .seal-year { font-size: 12px; font-weight: 900; color: ${accentGold}; }
  .corner { position: absolute; width: 32px; height: 32px; }
  .corner::before, .corner::after { content: ''; position: absolute; background: ${accentGold}; }
  .corner-tl { top: 17px; left: 64px; } .corner-tr { top: 17px; right: 17px; }
  .corner-bl { bottom: 17px; left: 64px; } .corner-br { bottom: 17px; right: 17px; }
  .corner::before { width: 100%; height: 1.5px; top: 0; left: 0; }
  .corner::after { width: 1.5px; height: 100%; top: 0; left: 0; }
  .corner-tr::after { left: auto; right: 0; }
  .corner-bl::before { top: auto; bottom: 0; }
  .corner-br::before { top: auto; bottom: 0; }
  .corner-br::after { left: auto; right: 0; }
  .footer { display: flex; align-items: flex-end; justify-content: space-between;
    border-top: 1px solid #e5e7eb; padding-top: 9px; margin-top: 4px; }
  .footer-meta { font-size: 9px; color: #9ca3af; line-height: 1.9; }
  .footer-meta b { color: #374151; }
  .signature-block { text-align: center; }
  .sig-line { width: 170px; height: 1px; background: #9ca3af; margin-bottom: 4px; }
  .sig-label { font-size: 9px; color: #6b7280; letter-spacing: .5px; }
  .footer-verify { font-size: 9px; color: #9ca3af; text-align: right; line-height: 1.9; }
  .footer-verify b { color: #374151; }
  @media print { body { background: #fff; } .cert { box-shadow: none; } }
</style></head><body>
<div class="cert">
  <div class="corner corner-tl"></div><div class="corner corner-tr"></div>
  <div class="corner corner-bl"></div><div class="corner corner-br"></div>
  <div class="ribbon">
    <div class="ribbon-text">MAS CALLNET</div>
    <div class="ribbon-line"></div>
    <div class="ribbon-text">CERTIFIED</div>
  </div>
  <div class="content">
    <div class="header">
      <div class="org-block">
        <div class="logo-wrap">${logoTag}</div>
        <div>
          <div class="org-name">MAS Callnet</div>
          <div class="org-sub">Training &amp; Quality &middot; MCN Learning Management System</div>
        </div>
      </div>
      <div class="cert-no-block">
        <div class="cert-no-label">Certificate No</div>
        <div class="cert-no">${esc(cert.certificate_no)}</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="body">
      <div class="watermark">MCN</div>
      <div class="cert-kind">${certKind}</div>
      <div class="cert-title">${esc(cert.title)}</div>
      <div class="presented">This is to certify that</div>
      <div class="trainee-name">${esc(cert.trainee_name || cert.employee_id)}</div>
      <div class="detail-row">
        ${isAssessment ? 'has successfully passed the assessment named above' : 'has successfully completed the training programme named above'}<br>
        ${cert.process ? `Process: <b>${esc(cert.process)}</b>` : ''}${cert.lob ? ` &middot; LOB: <b>${esc(cert.lob)}</b>` : ''}
        ${cert.batch_no ? `<br>Batch: <b>${esc(cert.batch_no)}</b>` : ''}
        <br>Employee ID: <b>${esc(cert.employee_id)}</b>
      </div>
      ${cert.score_pct !== null && cert.score_pct !== undefined ? `<div class="score-badge">Score: ${Math.round(Number(cert.score_pct))}%</div>` : ''}
      <div class="seal"><div class="seal-inner">T&amp;Q<br>VERIFIED</div><div class="seal-year">${new Date(cert.issued_at || Date.now()).getFullYear()}</div></div>
    </div>
    <div class="footer">
      <div class="footer-meta">
        <div>Issued: <b>${esc(issued)}</b></div>
        <div>Verification Code: <b>${esc(cert.verification_code)}</b></div>
      </div>
      <div class="signature-block">
        <div class="sig-line"></div>
        <div class="sig-label">Training &amp; Quality, MAS Callnet</div>
      </div>
      <div class="footer-verify">
        ${verifyUrl ? `<div>Verify at: <b>${esc(verifyUrl)}</b></div>` : ''}
        <div><b>mcnlms.teammas.in</b></div>
      </div>
    </div>
  </div>
</div></body></html>`;
}
