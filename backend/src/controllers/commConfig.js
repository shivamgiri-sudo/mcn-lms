import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { sendEmail, sendSms, sendWhatsApp } from '../utils/notify.js';

export async function getCommConfig(req, res) {
  try {
    let cfg = await prisma.communicationConfig.findUnique({ where: { id: 'default' } });
    if (!cfg) {
      cfg = await prisma.communicationConfig.create({ data: { id: 'default' } });
    }
    // Mask credentials for the response — return partial only
    res.json({
      ok: true,
      data: {
        smtpHost: cfg.smtpHost,
        smtpPort: cfg.smtpPort,
        smtpUser: cfg.smtpUser,
        smtpPassSet: cfg.smtpPass ? true : false,
        emailFrom: cfg.emailFrom,
        smtpEnabled: cfg.smtpEnabled,
        msg91SenderId: cfg.msg91SenderId,
        msg91TemplateId: cfg.msg91TemplateId,
        msg91AuthKeySet: cfg.msg91AuthKey ? true : false,
        smsEnabled: cfg.smsEnabled,
        msg91WhatsappIntegratedNumber: cfg.msg91WhatsappIntegratedNumber,
        msg91WhatsappTokenSet: cfg.msg91WhatsappToken ? true : false,
        whatsappEnabled: cfg.whatsappEnabled,
        updatedAt: cfg.updatedAt,
        updatedBy: cfg.updatedBy,
      },
    });
  } catch (err) {
    console.error('[commConfig] getCommConfig', err);
    res.status(500).json({ ok: false, message: 'Could not load config.' });
  }
}

export async function saveCommConfig(req, res) {
  try {
    const {
      smtpHost, smtpPort, smtpUser, smtpPass, emailFrom, smtpEnabled,
      msg91AuthKey, msg91SenderId, msg91TemplateId, smsEnabled,
      msg91WhatsappToken, msg91WhatsappIntegratedNumber, whatsappEnabled,
    } = req.body;

    const data = {
      updatedBy: req.userId,
    };

    if (smtpHost !== undefined) data.smtpHost = smtpHost;
    if (smtpPort !== undefined) data.smtpPort = parseInt(smtpPort, 10) || 587;
    if (smtpUser !== undefined) data.smtpUser = smtpUser;
    if (emailFrom !== undefined) data.emailFrom = emailFrom;
    if (smtpEnabled !== undefined) data.smtpEnabled = Boolean(smtpEnabled);
    // Only update password if a non-empty value was sent (empty = keep existing)
    if (smtpPass && smtpPass.trim()) data.smtpPass = smtpPass.trim();

    if (msg91SenderId !== undefined) data.msg91SenderId = msg91SenderId;
    if (msg91TemplateId !== undefined) data.msg91TemplateId = msg91TemplateId;
    if (smsEnabled !== undefined) data.smsEnabled = Boolean(smsEnabled);
    if (msg91AuthKey && msg91AuthKey.trim()) data.msg91AuthKey = msg91AuthKey.trim();

    if (msg91WhatsappIntegratedNumber !== undefined) data.msg91WhatsappIntegratedNumber = msg91WhatsappIntegratedNumber;
    if (whatsappEnabled !== undefined) data.whatsappEnabled = Boolean(whatsappEnabled);
    if (msg91WhatsappToken && msg91WhatsappToken.trim()) data.msg91WhatsappToken = msg91WhatsappToken.trim();

    await prisma.communicationConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_COMM_CONFIG', module: 'CommunicationConfig', referenceId: 'default' });
    res.json({ ok: true, message: 'Communication config saved.' });
  } catch (err) {
    console.error('[commConfig] saveCommConfig', err);
    res.status(500).json({ ok: false, message: 'Save failed.' });
  }
}

export async function testEmailConfig(req, res) {
  try {
    const { testEmail } = req.body;
    if (!testEmail) return res.status(400).json({ ok: false, message: 'testEmail required.' });

    const result = await sendEmail({
      to: testEmail,
      subject: 'MCN LMS — Email Config Test',
      html: `<p>This is a test email from MCN LMS Communication Config.<br>If you received this, your email configuration is working correctly.</p><p style="color:#6b7280;font-size:12px">Sent by Admin: ${req.userId}</p>`,
      text: `MCN LMS email config test. If you received this, email is working. Admin: ${req.userId}`,
    });

    res.json(result.ok ? { ok: true, message: `Test email sent to ${testEmail}.` } : { ok: false, message: result.message });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Test failed.' });
  }
}

export async function testSmsConfig(req, res) {
  try {
    const { testMobile } = req.body;
    if (!testMobile) return res.status(400).json({ ok: false, message: 'testMobile required.' });

    const result = await sendSms({
      mobile: testMobile,
      message: 'MCN LMS: SMS configuration test. If you received this, SMS is working correctly.',
    });

    res.json(result.ok ? { ok: true, message: `Test SMS sent to ${testMobile}.` } : { ok: false, message: result.message });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Test failed.' });
  }
}

export async function testWhatsAppConfig(req, res) {
  try {
    const { testMobile } = req.body;
    if (!testMobile) return res.status(400).json({ ok: false, message: 'testMobile required.' });

    const result = await sendWhatsApp({
      mobile: testMobile,
      message: 'MCN LMS WhatsApp config test.',
      templateName: 'lms_notification',
      params: ['MCN LMS', 'Config Test'],
    });

    res.json(result.ok ? { ok: true, message: `Test WhatsApp message sent to ${testMobile}.` } : { ok: false, message: result.message });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Test failed.' });
  }
}
