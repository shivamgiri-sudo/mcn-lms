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

export async function sendEmail({ to, subject, html, text }) {
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
    subject,
    text: text || '',
    html: html || text || '',
  });

  console.log('[NOTIFY] Email sent to', to);
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

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: 'Your MCN LMS Password Has Been Reset',
      html: `<p>Hi <b>${traineeName}</b>,</p><p>Your LMS password has been reset. Your temporary password is: <b>${tempPassword}</b></p><p>Please log in and change your password immediately.</p><p>— MCN LMS</p>`,
      text: `Hi ${traineeName}, your LMS password was reset. Temp password: ${tempPassword}. Please login and change it. — MCN LMS`,
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

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `You have been enrolled in a training batch — ${batchNo}`,
      html: `<p>Hi <b>${traineeName}</b>,</p><p>You have been enrolled in training batch <b>${batchNo}</b>${classroomName ? ` (${classroomName})` : ''}${proc ? ` for <b>${proc}</b>` : ''}.</p><p>Log in to MCN LMS to start your learning journey.</p><p>— MCN LMS</p>`,
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
      html: `<p>Hi <b>${traineeName || employeeId}</b>,</p>
<p>Your MCN LMS account has been created. Here are your login details:</p>
<table style="border:1px solid #e2e8f0;border-radius:6px;padding:16px;font-size:14px;width:100%;max-width:400px">
  <tr><td><b>Employee ID</b></td><td>${employeeId}</td></tr>
  <tr><td><b>Temporary Password</b></td><td><b>${tempPassword}</b></td></tr>
  ${batchNo ? `<tr><td><b>Batch</b></td><td>${batchNo}</td></tr>` : ''}
  ${proc ? `<tr><td><b>Process</b></td><td>${proc}</td></tr>` : ''}
</table>
<p style="margin-top:16px">Please log in at <a href="${loginUrl}">${loginUrl}</a> and change your password immediately.</p>
<p style="color:#6b7280;font-size:12px">— MCN LMS</p>`,
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

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `New module assigned: "${moduleName}" — MCN LMS`,
      html: `<p>Hi <b>${traineeName}</b>,</p>
<p>A new module has been assigned to you${broadcastTitle ? `: <b>${broadcastTitle}</b>` : ''}.</p>
<table style="border:1px solid #e2e8f0;border-radius:6px;padding:16px;font-size:14px;width:100%;max-width:400px">
  <tr><td><b>Module</b></td><td>${moduleName}</td></tr>
  <tr><td><b>Type</b></td><td>${assignmentType || 'Mandatory'}</td></tr>
  ${dueDateStr ? `<tr><td><b>Due Date</b></td><td>${dueDateStr}</td></tr>` : ''}
</table>
<p style="margin-top:16px">Log in to MCN LMS to complete this module.</p>
<p style="color:#6b7280;font-size:12px">— MCN LMS</p>`,
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

  if (email) {
    results.push(await sendEmail({
      to: email,
      subject: `New test assigned: "${assessmentName}" — MCN LMS`,
      html: `<p>Hi <b>${traineeName}</b>,</p>
<p>A test (PKT) has been assigned to you${moduleName ? ` as part of <b>${moduleName}</b>` : ''}.</p>
<table style="border:1px solid #e2e8f0;border-radius:6px;padding:16px;font-size:14px;width:100%;max-width:400px">
  <tr><td><b>Test</b></td><td>${assessmentName}</td></tr>
  ${moduleName ? `<tr><td><b>Module</b></td><td>${moduleName}</td></tr>` : ''}
  ${dueDateStr ? `<tr><td><b>Due Date</b></td><td>${dueDateStr}</td></tr>` : ''}
</table>
<p style="margin-top:16px">Log in to MCN LMS and open the <b>Assigned</b> tab to take this test.</p>
<p style="color:#6b7280;font-size:12px">— MCN LMS</p>`,
      text: `Hi ${traineeName}, a test (PKT) "${assessmentName}"${moduleName ? ` for module "${moduleName}"` : ''} has been assigned to you${dueDateStr ? `, due ${dueDateStr}` : ''}. Log in to the Assigned tab to take it.`,
    }));
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function certHtml({ traineeName, employeeId, batchNo, batchName, proc, lob, dateStr }) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#15803d;padding:24px 28px">
      <h2 style="color:#fff;margin:0">Congratulations — Certified!</h2>
      <p style="color:#bbf7d0;margin:6px 0 0;font-size:13px">MCN T&Q Training Operations</p>
    </div>
    <div style="padding:28px">
      <p>Dear <b>${traineeName}</b>,</p>
      <p>You have been <b style="color:#15803d">certified</b> as of <b>${dateStr}</b>.</p>
      <table style="width:100%;font-size:13px;color:#166534;border:1px solid #bbf7d0;border-radius:6px;padding:16px">
        <tr><td><b>Employee ID</b></td><td>${employeeId}</td></tr>
        <tr><td><b>Batch</b></td><td>${batchNo}${batchName ? ' — ' + batchName : ''}</td></tr>
        ${proc ? `<tr><td><b>Process</b></td><td>${proc}${lob ? ' / ' + lob : ''}</td></tr>` : ''}
        <tr><td><b>Date</b></td><td>${dateStr}</td></tr>
      </table>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:12px;color:#94a3b8">MCN T&Q Training Operations · Automated notification</p>
    </div>
  </div></body></html>`;
}
