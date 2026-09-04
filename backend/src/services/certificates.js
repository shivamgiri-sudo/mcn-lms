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
  const accent = isAssessment ? '#0f766e' : '#1a56db';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(cert.certificate_no)} - ${esc(cert.trainee_name)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 297mm; height: 210mm; display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', Roboto, Arial, sans-serif; background: #eef1f5; }
  .cert { width: 275mm; height: 185mm; background: #fff; border-radius: 12px; padding: 34px 54px;
    box-shadow: 0 8px 32px rgba(0,0,0,.15); border: 6px double ${accent};
    display: flex; flex-direction: column; position: relative; }
  .head { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #e5e7eb; padding-bottom: 14px; }
  .head img { height: 58px; width: auto; object-fit: contain; }
  .head .org { font-size: 20px; font-weight: 800; color: ${accent}; letter-spacing: .5px; }
  .head .sub { font-size: 12px; color: #6b7280; }
  .body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .kind { font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: ${accent}; font-weight: 700; }
  .title { font-size: 30px; font-weight: 800; color: #111827; margin: 4px 0 18px; }
  .presented { font-size: 14px; color: #4b5563; }
  .name { font-size: 40px; font-weight: 800; color: #111827; margin: 6px 0 10px; }
  .detail { font-size: 14px; color: #4b5563; line-height: 1.8; }
  .score { margin-top: 12px; font-size: 15px; font-weight: 700; color: ${accent}; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end;
    border-top: 2px solid #e5e7eb; padding-top: 12px; font-size: 11px; color: #6b7280; }
  .foot b { color: #374151; }
  .sign { text-align: center; }
  .sign .line { width: 190px; border-top: 1px solid #9ca3af; margin-bottom: 4px; }
  .stamp { position: absolute; bottom: 74px; right: 62px; width: 92px; height: 92px; border: 2px solid ${accent};
    border-radius: 50%; display: flex; align-items: center; justify-content: center; text-align: center;
    font-size: 9px; font-weight: 700; color: ${accent}; transform: rotate(-14deg); line-height: 1.4; }
  @media print { body { background: #fff; } .cert { box-shadow: none; } }
</style></head><body>
<div class="cert">
  <div class="head">
    ${logo ? `<img src="${logo}" alt="MCN">` : ''}
    <div><div class="org">MAS Callnet</div><div class="sub">Training &amp; Quality &middot; MCN Learning Management System</div></div>
  </div>
  <div class="body">
    <div class="kind">${isAssessment ? 'Certificate of Achievement' : 'Certificate of Completion'}</div>
    <div class="title">${esc(cert.title)}</div>
    <div class="presented">This is to certify that</div>
    <div class="name">${esc(cert.trainee_name || cert.employee_id)}</div>
    <div class="detail">
      ${isAssessment
        ? 'has successfully passed the assessment named above'
        : 'has successfully completed the training programme named above'}<br>
      ${cert.process ? `Process: <b>${esc(cert.process)}</b>` : ''}${cert.lob ? ` &middot; LOB: <b>${esc(cert.lob)}</b>` : ''}
      ${cert.batch_no ? `<br>Batch: <b>${esc(cert.batch_no)}</b>` : ''}
      <br>Employee ID: <b>${esc(cert.employee_id)}</b>
    </div>
    ${cert.score_pct !== null && cert.score_pct !== undefined ? `<div class="score">Score: ${Math.round(Number(cert.score_pct))}%</div>` : ''}
  </div>
  <div class="foot">
    <div>
      <div>Certificate No: <b>${esc(cert.certificate_no)}</b></div>
      <div>Verification Code: <b>${esc(cert.verification_code)}</b></div>
      ${verifyUrl ? `<div>Verify at: ${esc(verifyUrl)}</div>` : ''}
    </div>
    <div class="sign"><div class="line"></div>Training &amp; Quality, MAS Callnet</div>
    <div>Issued: <b>${esc(issued)}</b></div>
  </div>
  <div class="stamp">MAS CALLNET<br>T&amp;Q<br>VERIFIED</div>
</div></body></html>`;
}
