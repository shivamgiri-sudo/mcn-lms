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

// ── SMS (MSG91) ───────────────────────────────────────────────────────────────

export async function sendSms({ mobile, message, templateId }) {
  const cfg = await getConfig();
  if (!cfg.smsEnabled) {
    console.warn('[NOTIFY] SMS disabled in config.');
    return { ok: false, message: 'SMS not enabled in Communication Config.' };
  }
  if (!cfg.msg91AuthKey) {
    return { ok: false, message: 'MSG91 auth key not configured.' };
  }

  // Normalise mobile to 91XXXXXXXXXX format
  const clean = String(mobile).replace(/\D/g, '');
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

export async function sendWhatsApp({ mobile, message, templateName, params }) {
  const cfg = await getConfig();
  if (!cfg.whatsappEnabled) {
    console.warn('[NOTIFY] WhatsApp disabled in config.');
    return { ok: false, message: 'WhatsApp not enabled in Communication Config.' };
  }
  if (!cfg.msg91WhatsappToken || !cfg.msg91WhatsappIntegratedNumber) {
    return { ok: false, message: 'MSG91 WhatsApp token/number not configured.' };
  }

  const clean = String(mobile).replace(/\D/g, '');
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
