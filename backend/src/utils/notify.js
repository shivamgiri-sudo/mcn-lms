/**
 * notify.js — unified notification dispatcher
 * Reads provider config from communication_config table at call time.
 * Supports: email (nodemailer/SMTP), SMS (MSG91), WhatsApp (MSG91 WhatsApp API).
 */

import nodemailer from 'nodemailer';
import { prisma } from './db.js';

async function getConfig() {
  try {
    const cfg = await prisma.communicationConfig.findUnique({ where: { id: 'default' } });
    return cfg || {};
  } catch {
    return {};
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

export async function sendEmail({ to, cc, subject, html, text }) {
  const cfg = await getConfig();
  if (!cfg.smtpEnabled) {
    console.warn('[NOTIFY] Email disabled in config. Skipping send to:', to);
    return { ok: false, message: 'Email not enabled in Communication Config.' };
  }
  if (!cfg.smtpUser || !cfg.smtpPass) {
    return { ok: false, message: 'SMTP credentials not configured.' };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost || 'smtp.gmail.com',
    port: cfg.smtpPort || 587,
    secure: (cfg.smtpPort || 587) === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
  });

  await transporter.sendMail({
    from: cfg.emailFrom || cfg.smtpUser,
    to: Array.isArray(to) ? to.join(',') : to,
    ...(cc ? { cc: Array.isArray(cc) ? cc.join(',') : cc } : {}),
    subject,
    text: text || '',
    html: html || text || '',
  });

  console.log('[NOTIFY] Email sent to', to, cc ? `(cc: ${cc})` : '');
  return { ok: true };
}

// ── SMS (SmartPing, DLT templated) ────────────────────────────────────────────
//
// Indian SMS is governed by TRAI DLT: the text sent must MATCH a template that
// was registered with the operator, and the request must carry that template's
// content id. Sending arbitrary wording is rejected at the gateway, and the
// HRMS side of this business learned that the expensive way - 901 failures and
// zero successes over months, all reported only as "status code 400".
//
// So this path refuses to send anything that is not built from a registered
// template. Failing here keeps the recorded error truthful and avoids firing
// non-compliant content at the operator.
export const SMARTPING_DLT = {
  training_assigned: {
    dltContentId: '1707178393378172639',
    build: v => 'Dear ' + v[0] + ', training module ' + v[1] + ' has been assigned to you in HRMS. Please complete it by ' + v[2] + '. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'module_name', 'deadline'],
  },
  training_reminder: {
    dltContentId: '1707178393384289108',
    build: v => 'Dear ' + v[0] + ', your training module ' + v[1] + ' is pending. Please complete it by ' + v[2] + '. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'module_name', 'deadline'],
  },
  pkt_scheduled: {
    dltContentId: '1707178393391295367',
    build: v => 'Dear ' + v[0] + ', your PKT for ' + v[1] + ' is scheduled on ' + v[2] + '. Please check HRMS for details. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'subject', 'scheduled_date'],
  },
  pkt_result: {
    dltContentId: '1707178393397311672',
    build: v => 'Dear ' + v[0] + ', your PKT result for ' + v[1] + ' has been updated as ' + v[2] + '. - Ispark',
    variableCount: 3,
    variableNames: ['name', 'subject', 'result'],
  },
};

function normaliseIndianMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return /^[6-9][0-9]{9}$/.test(last10) ? last10 : '';
}

export function smartPingConfigured() {
  return Boolean(process.env.SMARTPING_USERNAME && process.env.SMARTPING_PASSWORD);
}

// Send one SMS built from a registered DLT template.
//   template: a key of SMARTPING_DLT
//   vars:     the template variables, in registered order
export async function sendTemplatedSms({ mobile, to, template, vars = [] }) {
  const destination = mobile || to;
  const entry = SMARTPING_DLT[template];
  if (!entry) {
    return { ok: false, message: 'No registered DLT template named ' + template + '. Register it before sending.' };
  }
  if (vars.length !== entry.variableCount) {
    return { ok: false, message: template + ' expects ' + entry.variableCount + ' variables (' + entry.variableNames.join(', ') + '), received ' + vars.length + '.' };
  }
  const msisdn = normaliseIndianMobile(destination);
  if (!msisdn) return { ok: false, message: 'Invalid Indian mobile number: ' + destination };
  if (!smartPingConfigured()) return { ok: false, message: 'SmartPing credentials are not configured.' };

  const text = entry.build(vars.map(v => String(v ?? '')));
  const params = new URLSearchParams({
    username: process.env.SMARTPING_USERNAME,
    password: process.env.SMARTPING_PASSWORD,
    unicode: 'false',
    from: process.env.SMARTPING_SENDER_ID || 'Ispark',
    to: msisdn,
    text,
    dltContentId: entry.dltContentId,
    dltEntityId: process.env.SMARTPING_ENTITY_ID || '',
  });

  try {
    const resp = await fetch('http://enterprise.smartping.ai/v3/api.php?' + params.toString(), { method: 'GET' });
    const body = await resp.text();
    if (!resp.ok) {
      console.error('[NOTIFY] SmartPing SMS failed:', resp.status, body.slice(0, 200));
      return { ok: false, message: 'SMS gateway returned ' + resp.status + '.' };
    }
    console.log('[NOTIFY] SmartPing SMS sent to', msisdn, 'template', template);
    return { ok: true, gatewayResponse: body.slice(0, 200) };
  } catch (error) {
    console.error('[NOTIFY] SmartPing SMS threw:', error.message);
    return { ok: false, message: 'Could not reach the SMS gateway.' };
  }
}

// ── SMS (MSG91) ───────────────────────────────────────────────────────────────

export async function sendSms({ mobile, to, message, templateId }) {
  const destination = mobile || to;
  if (!destination) return { ok: false, message: 'SMS recipient is required.' };
  const cfg = await getConfig();
  if (!cfg.smsEnabled) {
    console.warn('[NOTIFY] SMS disabled in config.');
    return { ok: false, message: 'SMS not enabled in Communication Config.' };
  }
  if (!cfg.msg91AuthKey) {
    return { ok: false, message: 'MSG91 auth key not configured.' };
  }

  // Normalise mobile to 91XXXXXXXXXX format.
  const clean = String(destination).replace(/\D/g, '');
  const msisdn = clean.startsWith('91') ? clean : `91${clean.slice(-10)}`;

  const tid = templateId || cfg.msg91TemplateId;
  const body = {
    template_id: tid,
    sender: cfg.msg91SenderId || 'MCNLMS',
    short_url: '0',
    realTimeResponse: '1',
    recipients: [{ mobiles: msisdn, var1: message }],
  };

  const resp = await fetch('https://api.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: cfg.msg91AuthKey,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.type === 'error') {
    console.error('[NOTIFY] MSG91 SMS error:', json);
    return { ok: false, message: json.message || 'SMS send failed.' };
  }

  console.log('[NOTIFY] SMS sent to', msisdn);
  return { ok: true };
}

// ── WhatsApp (MSG91) ──────────────────────────────────────────────────────────

export async function sendWhatsApp({ mobile, to, message, templateName, params }) {
  const destination = mobile || to;
  if (!destination) return { ok: false, message: 'WhatsApp recipient is required.' };
  const cfg = await getConfig();
  if (!cfg.whatsappEnabled) {
    console.warn('[NOTIFY] WhatsApp disabled in config.');
    return { ok: false, message: 'WhatsApp not enabled in Communication Config.' };
  }
  if (!cfg.msg91WhatsappToken || !cfg.msg91WhatsappIntegratedNumber) {
    return { ok: false, message: 'MSG91 WhatsApp token/number not configured.' };
  }

  const clean = String(destination).replace(/\D/g, '');
  const msisdn = clean.startsWith('91') ? clean : `91${clean.slice(-10)}`;

  const body = {
    integrated_number: cfg.msg91WhatsappIntegratedNumber,
    content_type: 'template',
    payload: {
      to: msisdn,
      type: 'template',
      template: {
        name: templateName || 'lms_notification',
        language: { code: 'en' },
        components: params ? [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: p })) }] : [],
      },
    },
  };

  const resp = await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authkey: cfg.msg91WhatsappToken,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.type === 'error') {
    console.error('[NOTIFY] MSG91 WhatsApp error:', json);
    return { ok: false, message: json.message || 'WhatsApp send failed.' };
  }

  console.log('[NOTIFY] WhatsApp sent to', msisdn);
  return { ok: true };
}

// ── Event dispatchers (call these on LMS events) ───────────────────────────────

export async function notifyCertification({ traineeName, employeeId, email, mobile, batchNo, batchName, process: proc, lob }) {
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const results = [];

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `Congratulations on your Certification — ${traineeName}`,
      html: certHtml({ traineeName, employeeId, batchNo, batchName, proc, lob, dateStr }),
      text: `Congratulations ${traineeName}! You have been certified as of ${dateStr}. Batch: ${batchNo}. Employee ID: ${employeeId}.`,
    }));
  }

  if (mobile) {
    results.push(await sendSms({
      mobile,
      message: `Congratulations ${traineeName}! You are certified as of ${dateStr}. Batch: ${batchNo}. - MCN LMS`,
    }));
    results.push(await sendWhatsApp({
      mobile,
      message: `Congratulations ${traineeName}! Certified as of ${dateStr}.`,
      params: [traineeName, dateStr, batchNo],
    }));
  }

  return results;
}

export async function notifyPasswordReset({ traineeName, mobile, email, tempPassword }) {
  const results = [];
  const loginUrl = process.env.FRONTEND_URL || 'https://mcnlms.teammas.in';

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: 'Your MCN LMS Password Has Been Reset',
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fef2f2;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fef2f2;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#991b1b 0%,#dc2626 100%);padding:32px 40px">
  <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-bottom:6px">&#128272; Your Password Has Been Reset</div>
  <div style="font-size:13px;color:#fecaca">MCN LMS Security Notification</div>
</td></tr>
<tr><td style="padding:32px 40px">
  <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#fffbeb;border:2px solid #fbbf24;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:28px;font-size:20px;vertical-align:top">&#9888;&#65039;</td>
          <td style="padding-left:10px;font-size:13px;color:#92400e;line-height:1.6"><strong>Security Alert:</strong> This action was performed by an Administrator. If you did not request this reset, contact your coordinator immediately.</td>
        </tr>
      </table>
    </td></tr>
  </table>
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Dear <strong>${traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">Your MCN LMS account password has been reset by an administrator. Use the temporary password below to log in, then change it immediately.</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="padding:14px 20px 8px">
      <div style="font-size:11px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Temporary Password</div>
    </td></tr>
    <tr><td style="padding:0 20px 18px">
      <span style="font-size:20px;font-family:Courier New,monospace;background:#92400e;color:#fef3c7;padding:8px 18px;border-radius:6px;font-weight:bold;letter-spacing:3px;display:inline-block">${tempPassword}</span>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none;letter-spacing:0.3px">Log In &amp; Change Password &#8594;</a>
    </td></tr>
  </table>
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:#166534;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Security Checklist</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:5px 0;font-size:13px;color:#166534">&#9989;&nbsp; Change this temporary password immediately after login</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#166534">&#9989;&nbsp; Do not share your credentials with anyone, including coordinators</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#166534">&#9989;&nbsp; Contact your coordinator if you did not expect this reset</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Security Notification</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      text: `Hi ${traineeName}, your LMS password was reset. Temp password: ${tempPassword}. Please login and change it immediately. — MCN LMS`,
    }));
  }

  if (mobile) {
    results.push(await sendSms({
      mobile,
      message: `MCN LMS: Your password has been reset. Temp password: ${tempPassword}. Login at mcnlms.teammas.in`,
    }));
  }

  return results;
}

export async function notifyBatchAssignment({ traineeName, mobile, email, batchNo, classroomName, process: proc }) {
  const results = [];
  const loginUrl = process.env.FRONTEND_URL || 'https://mcnlms.teammas.in';

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `You have been enrolled in a training batch — ${batchNo}`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2ff;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#4f46e5 0%,#6366f1 100%);padding:32px 40px">
  <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-bottom:6px">&#128203; You've Been Enrolled in a Training Batch</div>
  <div style="font-size:13px;color:#c7d2fe">MCN LMS — Training Operations</div>
</td></tr>
<tr><td style="padding:32px 40px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 20px">Dear <strong>${traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">Welcome aboard! You have been officially enrolled in the following training batch. Your learning journey begins now.</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#4f46e5;padding:12px 20px">
      <div style="font-size:11px;font-weight:bold;color:#c7d2fe;text-transform:uppercase;letter-spacing:1px">Enrollment Details</div>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #ddd6fe">
          <td style="padding:12px 20px;font-size:13px;color:#6d28d9;font-weight:bold;width:140px">Batch No.</td>
          <td style="padding:12px 20px;font-size:15px;font-weight:bold;color:#1e293b">${batchNo}</td>
        </tr>
        ${classroomName ? `<tr style="border-bottom:1px solid #ddd6fe">
          <td style="padding:12px 20px;font-size:13px;color:#6d28d9;font-weight:bold">Programme</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${classroomName}</td>
        </tr>` : ''}
        ${proc ? `<tr>
          <td style="padding:12px 20px;font-size:13px;color:#6d28d9;font-weight:bold">Process</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${proc}</td>
        </tr>` : ''}
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none">View Your Batch Dashboard &#8594;</a>
    </td></tr>
  </table>
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:#6d28d9;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">What to Expect</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#4f46e5;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">1</td>
            <td style="padding-left:10px;font-size:13px;color:#4c1d95">Sequential curriculum modules — unlock day by day</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#4f46e5;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">2</td>
            <td style="padding-left:10px;font-size:13px;color:#4c1d95">PKT assessments at key milestones — study the material before each test</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#4f46e5;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">3</td>
            <td style="padding-left:10px;font-size:13px;color:#4c1d95">Daily Typing Test — target 35 WPM / 95% accuracy, every working day</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Notification</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      text: `Hi ${traineeName}, you have been enrolled in batch ${batchNo}. Log in to MCN LMS to start learning. — MCN LMS`,
    }));
  }

  if (mobile) {
    results.push(await sendSms({
      mobile,
      message: `MCN LMS: You are enrolled in batch ${batchNo}${classroomName ? ` (${classroomName})` : ''}. Login to start your training.`,
    }));
  }

  return results;
}

export async function notifyOnboarding({ traineeName, employeeId, mobile, email, batchNo, classroomName, process: proc, tempPassword }) {
  const results = [];
  const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `Welcome to MCN LMS — Your login credentials`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eff6ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eff6ff;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);padding:36px 40px">
  <div style="font-size:28px;font-weight:bold;color:#ffffff;margin-bottom:8px">Welcome to MCN LMS &#127881;</div>
  <div style="font-size:14px;color:#bfdbfe">Your learning journey starts today</div>
</td></tr>
<tr><td style="padding:32px 40px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px">Dear <strong>${traineeName || employeeId}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">Your MCN Learning Management System account has been created and is ready. Use the credentials below to log in and begin your training programme.</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="padding:14px 20px 6px">
      <div style="font-size:11px;font-weight:bold;color:#94a3b8;text-transform:uppercase;letter-spacing:1px">Your Login Credentials</div>
    </td></tr>
    <tr><td style="padding:0 20px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #1e293b">
        <tr><td style="padding:12px 0;border-bottom:1px solid #1e293b">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:#94a3b8;width:150px">Employee ID</td>
              <td style="font-size:16px;font-weight:bold;color:#60a5fa">${employeeId}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:12px 0;border-bottom:1px solid #1e293b">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:#94a3b8;width:150px">Temp Password</td>
              <td><span style="font-size:16px;font-family:Courier New,monospace;background:#92400e;color:#fef3c7;padding:5px 12px;border-radius:5px;font-weight:bold;letter-spacing:2px;display:inline-block">${tempPassword}</span></td>
            </tr>
          </table>
        </td></tr>
        ${batchNo ? `<tr><td style="padding:12px 0;border-bottom:1px solid #1e293b">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:#94a3b8;width:150px">Batch</td>
              <td style="font-size:14px;color:#e2e8f0">${batchNo}</td>
            </tr>
          </table>
        </td></tr>` : ''}
        ${proc ? `<tr><td style="padding:12px 0">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:#94a3b8;width:150px">Process</td>
              <td style="font-size:14px;color:#e2e8f0">${proc}</td>
            </tr>
          </table>
        </td></tr>` : ''}
      </table>
    </td></tr>
    <tr><td style="padding:0 20px 18px"></td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none;letter-spacing:0.3px">Log In to MCN LMS &#8594;</a>
    </td></tr>
  </table>
  <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#fffbeb;border:2px solid #fbbf24;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:28px;font-size:20px;vertical-align:top">&#9888;&#65039;</td>
          <td style="padding-left:10px;font-size:13px;color:#92400e;line-height:1.6"><strong>Please change your password immediately after first login.</strong> Your temporary password should not be kept as your permanent password.</td>
        </tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:#1e40af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Your First Steps</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:6px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:26px;height:26px;background:#2563eb;border-radius:50%;text-align:center;font-size:12px;font-weight:bold;color:#fff;vertical-align:middle">1</td>
            <td style="padding-left:10px;font-size:13px;color:#1e40af">Complete your profile and update your photo</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:6px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:26px;height:26px;background:#2563eb;border-radius:50%;text-align:center;font-size:12px;font-weight:bold;color:#fff;vertical-align:middle">2</td>
            <td style="padding-left:10px;font-size:13px;color:#1e40af">Start your Day 1 curriculum — modules unlock sequentially</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:6px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:26px;height:26px;background:#2563eb;border-radius:50%;text-align:center;font-size:12px;font-weight:bold;color:#fff;vertical-align:middle">3</td>
            <td style="padding-left:10px;font-size:13px;color:#1e40af">Take your first Daily Typing Test — target 35 WPM / 95% accuracy</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Notification</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      text: `Hi ${traineeName || employeeId}, your MCN LMS account is ready. Employee ID: ${employeeId}, Temp Password: ${tempPassword}. Login at ${loginUrl} and change your password.`,
    }));
  }

  if (mobile) {
    results.push(await sendSms({
      mobile,
      message: `MCN LMS: Account created. ID: ${employeeId}, Temp PW: ${tempPassword}. Login: ${loginUrl}`,
    }));
    results.push(await sendWhatsApp({
      mobile,
      message: `MCN LMS account created. Login with ID: ${employeeId}, Temp password: ${tempPassword}`,
      params: [traineeName || employeeId, employeeId, tempPassword],
    }));
  }
  return results;
}

export async function notifyModuleAssigned({ traineeName, email, mobile, moduleName, broadcastTitle, dueDate, assignmentType }) {
  const results = [];
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  const loginUrl = process.env.FRONTEND_URL || 'https://mcnlms.teammas.in';
  const isMandatory = !assignmentType || assignmentType === 'Mandatory';
  const typeBadgeBg = isMandatory ? '#16a34a' : '#d97706';
  const typeBadgeText = isMandatory ? '#ffffff' : '#ffffff';
  const dueDate3Days = dueDate && (new Date(dueDate) - Date.now()) < 3 * 24 * 60 * 60 * 1000;

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `New module assigned: "${moduleName}" — MCN LMS`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ff;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#4c1d95 0%,#7c3aed 100%);padding:32px 40px">
  <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-bottom:6px">&#128218; New Module Assigned to You</div>
  <div style="font-size:13px;color:#ddd6fe">MCN LMS — Learning &amp; Development</div>
</td></tr>
<tr><td style="padding:32px 40px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 20px">Dear <strong>${traineeName}</strong>,</p>
  ${broadcastTitle ? `<table width="100%" cellpadding="10" cellspacing="0" border="0" style="background:#faf5ff;border:1px solid #ddd6fe;border-radius:8px;margin-bottom:20px">
    <tr><td>
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:16px;padding-right:8px">&#128226;</td>
        <td style="font-size:13px;color:#6d28d9;font-weight:bold">Broadcast:&nbsp;</td>
        <td style="font-size:13px;color:#4c1d95">${broadcastTitle}</td>
      </tr></table>
    </td></tr>
  </table>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf5ff;border:2px solid #c4b5fd;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#7c3aed;padding:12px 20px">
      <div style="font-size:11px;font-weight:bold;color:#ddd6fe;text-transform:uppercase;letter-spacing:1px">Module Details</div>
    </td></tr>
    <tr><td style="padding:18px 20px 0">
      <div style="font-size:18px;font-weight:bold;color:#1e293b;margin-bottom:14px">${moduleName}</div>
    </td></tr>
    <tr><td style="padding:0 20px 18px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:12px">
            <span style="background:${typeBadgeBg};color:${typeBadgeText};font-size:11px;font-weight:bold;padding:4px 12px;border-radius:20px;display:inline-block">${assignmentType || 'Mandatory'}</span>
          </td>
          ${dueDateStr ? `<td>
            <span style="background:${dueDate3Days ? '#fef2f2' : '#f0fdf4'};color:${dueDate3Days ? '#dc2626' : '#16a34a'};border:1px solid ${dueDate3Days ? '#fecaca' : '#86efac'};font-size:12px;font-weight:bold;padding:4px 12px;border-radius:20px;display:inline-block">Due: ${dueDateStr}${dueDate3Days ? ' &#128680;' : ''}</span>
          </td>` : ''}
        </tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:24px">
    <tr><td style="padding:14px 20px">
      <div style="font-size:11px;color:#64748b;margin-bottom:8px">Progress Milestone</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:12px;color:#475569;width:28px">0%</td>
          <td style="padding:0 8px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e2e8f0;border-radius:4px;height:10px">
              <tr><td style="background:#7c3aed;width:0%;border-radius:4px;height:10px"></td></tr>
            </table>
          </td>
          <td style="font-size:12px;color:#475569;width:80px;text-align:right">${dueDateStr ? `by ${dueDateStr}` : 'Complete'}</td>
        </tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none">Open Module in LMS &#8594;</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Notification</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      text: `Hi ${traineeName}, module "${moduleName}" has been assigned to you${dueDateStr ? `, due ${dueDateStr}` : ''}. Log in to complete it.`,
    }));
  }

  if (mobile) {
    results.push(await sendSms({
      mobile,
      message: `MCN LMS: Module "${moduleName}" assigned to you${dueDateStr ? `. Due: ${dueDateStr}` : ''}. Login to complete.`,
    }));
  }
  return results;
}

export async function notifyAssessmentAssigned({ traineeName, email, moduleName, assessmentName, dueDate }) {
  const results = [];
  const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  const loginUrl = process.env.FRONTEND_URL || 'https://mcnlms.teammas.in';

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `New test assigned: "${assessmentName}" — MCN LMS`,
      html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fffbeb;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#92400e 0%,#d97706 100%);padding:32px 40px">
  <div style="font-size:24px;font-weight:bold;color:#ffffff;margin-bottom:6px">&#128221; New Assessment Assigned: PKT</div>
  <div style="font-size:13px;color:#fde68a">MCN LMS — Knowledge Verification</div>
</td></tr>
<tr><td style="padding:32px 40px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 20px">Dear <strong>${traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">A Process Knowledge Test (PKT) has been assigned to you${moduleName ? ` as part of <strong>${moduleName}</strong>` : ''}. Review the material and complete it before the due date.</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:2px solid #fbbf24;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:#d97706;padding:12px 20px">
      <div style="font-size:11px;font-weight:bold;color:#fef3c7;text-transform:uppercase;letter-spacing:1px">Assessment Details</div>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold;width:130px">Assessment</td>
          <td style="padding:12px 20px;font-size:15px;font-weight:bold;color:#1e293b">${assessmentName}</td>
        </tr>
        ${moduleName ? `<tr style="border-bottom:1px solid #fde68a">
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold">Module</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${moduleName}</td>
        </tr>` : ''}
        ${dueDateStr ? `<tr>
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold">Due Date</td>
          <td style="padding:12px 20px;font-size:14px;font-weight:bold;color:#dc2626">${dueDateStr}</td>
        </tr>` : ''}
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:#1e40af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Preparation Tips</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:5px 0;font-size:13px;color:#1e3a8a">&#128161;&nbsp; Re-read all module content before attempting the PKT</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#1e3a8a">&#128161;&nbsp; Note key concepts, definitions and process steps</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#1e3a8a">&#128161;&nbsp; Attempt the test in a quiet environment — no interruptions</td></tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;background:#d97706;color:#ffffff;font-size:15px;font-weight:bold;padding:14px 40px;border-radius:8px;text-decoration:none">Take Assessment &#8594;</a>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Notification</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
      text: `Hi ${traineeName}, a test (PKT) "${assessmentName}"${moduleName ? ` for module "${moduleName}"` : ''} has been assigned to you${dueDateStr ? `, due ${dueDateStr}` : ''}. Log in to the Assigned tab to take it.`,
    }));
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function certHtml({ traineeName, employeeId, batchNo, batchName, proc, lob, dateStr }) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ecfdf5;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfdf5;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
<tr><td style="background:linear-gradient(135deg,#064e3b 0%,#059669 100%);padding:40px 40px 32px">
  <div style="font-size:32px;margin-bottom:12px">&#127891;</div>
  <div style="font-size:26px;font-weight:bold;color:#ffffff;margin-bottom:8px">Congratulations — You're Certified!</div>
  <div style="font-size:14px;color:#a7f3d0">MCN T&amp;Q Training Operations</div>
</td></tr>
<tr><td style="padding:32px 40px">
  <p style="font-size:15px;color:#1e293b;margin:0 0 20px">Dear <strong>${traineeName}</strong>,</p>
  <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6">You have successfully completed your training programme and are now <strong style="color:#059669">certified</strong>. This is a significant achievement — well done!</p>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fefce8;border:3px solid #fbbf24;border-radius:10px;overflow:hidden;margin-bottom:24px">
    <tr><td style="background:linear-gradient(90deg,#fbbf24,#f59e0b);padding:14px 20px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:20px">&#127942;</td>
          <td style="padding-left:10px;font-size:14px;font-weight:bold;color:#1e293b">Achievement Unlocked — Process Knowledge Certified</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold;width:140px">Employee ID</td>
          <td style="padding:12px 20px;font-size:15px;font-weight:bold;color:#1e293b">${employeeId}</td>
        </tr>
        <tr style="border-bottom:1px solid #fde68a">
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold">Batch</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${batchNo}${batchName ? ' — ' + batchName : ''}</td>
        </tr>
        ${proc ? `<tr style="border-bottom:1px solid #fde68a">
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold">Process / LOB</td>
          <td style="padding:12px 20px;font-size:14px;color:#1e293b">${proc}${lob ? ' / ' + lob : ''}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:12px 20px;font-size:13px;color:#92400e;font-weight:bold">Certified Date</td>
          <td style="padding:12px 20px;font-size:14px;font-weight:bold;color:#059669">${dateStr}</td>
        </tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="14" cellspacing="0" border="0" style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;margin-bottom:24px">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="width:28px;font-size:20px;vertical-align:top">&#10003;</td>
          <td style="padding-left:10px;font-size:13px;color:#065f46;line-height:1.6">This certification confirms your readiness for operations. Your Trainer and Operations team have been notified.</td>
        </tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="16" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px">
    <tr><td>
      <div style="font-size:11px;font-weight:bold;color:#1e40af;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">What's Next</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#059669;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">1</td>
            <td style="padding-left:10px;font-size:13px;color:#1e3a8a">Your coordinator will initiate the Operations onboarding process</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#059669;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">2</td>
            <td style="padding-left:10px;font-size:13px;color:#1e3a8a">Your LMS access remains active — continue with any outstanding modules</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:24px;height:24px;background:#059669;border-radius:50%;text-align:center;font-size:11px;font-weight:bold;color:#fff;vertical-align:middle">3</td>
            <td style="padding-left:10px;font-size:13px;color:#1e3a8a">Download your certificate from the LMS Achievements section</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-size:12px;color:#64748b"><strong>MCN T&amp;Q Training Operations</strong> &nbsp;&middot;&nbsp; Automated Notification</td>
      <td align="right" style="font-size:11px;color:#94a3b8">mcnlms.teammas.in</td>
    </tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
