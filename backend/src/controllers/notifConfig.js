import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

export async function getNotifConfig(req, res) {
  try {
    let cfg = await prisma.notificationConfig.findUnique({ where: { id: 'default' } });
    if (!cfg) cfg = await prisma.notificationConfig.create({ data: { id: 'default' } });
    res.json({ ok: true, data: cfg });
  } catch (err) {
    console.error('[notifConfig] get', err);
    res.status(500).json({ ok: false, message: 'Could not load notification config.' });
  }
}

export async function saveNotifConfig(req, res) {
  try {
    const {
      notifyOnboard, notifyPasswordReset, notifyCertification,
      notifyBatchAssignment, notifyModuleAssigned,
      deadlineReminderDays, deadlineReminderEnabled, deadlineReminderTime,
      completionReminderEnabled, completionReminderDays, completionReminderTime,
      dailyCoverageEnabled, dailyCoverageTime, dailyCoverageRecipients,
      coordinatorAlertEnabled, coordinatorAlertTime, coordinatorAlertMinRisk,
      pendingActivityAlertEnabled, pendingActivityAlertTime, pendingActivityAlertDays,
    } = req.body;

    const data = { updatedBy: req.userId };
    const bool = v => v !== undefined ? Boolean(v) : undefined;
    const int = v => v !== undefined ? parseInt(v, 10) : undefined;
    const str = v => v !== undefined ? String(v) : undefined;

    if (bool(notifyOnboard) !== undefined) data.notifyOnboard = bool(notifyOnboard);
    if (bool(notifyPasswordReset) !== undefined) data.notifyPasswordReset = bool(notifyPasswordReset);
    if (bool(notifyCertification) !== undefined) data.notifyCertification = bool(notifyCertification);
    if (bool(notifyBatchAssignment) !== undefined) data.notifyBatchAssignment = bool(notifyBatchAssignment);
    if (bool(notifyModuleAssigned) !== undefined) data.notifyModuleAssigned = bool(notifyModuleAssigned);
    if (int(deadlineReminderDays) !== undefined) data.deadlineReminderDays = int(deadlineReminderDays);
    if (bool(deadlineReminderEnabled) !== undefined) data.deadlineReminderEnabled = bool(deadlineReminderEnabled);
    if (str(deadlineReminderTime) !== undefined) data.deadlineReminderTime = str(deadlineReminderTime);
    if (bool(completionReminderEnabled) !== undefined) data.completionReminderEnabled = bool(completionReminderEnabled);
    if (int(completionReminderDays) !== undefined) data.completionReminderDays = int(completionReminderDays);
    if (str(completionReminderTime) !== undefined) data.completionReminderTime = str(completionReminderTime);
    if (bool(dailyCoverageEnabled) !== undefined) data.dailyCoverageEnabled = bool(dailyCoverageEnabled);
    if (str(dailyCoverageTime) !== undefined) data.dailyCoverageTime = str(dailyCoverageTime);
    if (dailyCoverageRecipients !== undefined) data.dailyCoverageRecipients = dailyCoverageRecipients;
    if (bool(coordinatorAlertEnabled) !== undefined) data.coordinatorAlertEnabled = bool(coordinatorAlertEnabled);
    if (str(coordinatorAlertTime) !== undefined) data.coordinatorAlertTime = str(coordinatorAlertTime);
    if (str(coordinatorAlertMinRisk) !== undefined) data.coordinatorAlertMinRisk = str(coordinatorAlertMinRisk);
    if (bool(pendingActivityAlertEnabled) !== undefined) data.pendingActivityAlertEnabled = bool(pendingActivityAlertEnabled);
    if (str(pendingActivityAlertTime) !== undefined) data.pendingActivityAlertTime = str(pendingActivityAlertTime);
    if (int(pendingActivityAlertDays) !== undefined) data.pendingActivityAlertDays = int(pendingActivityAlertDays);

    await prisma.notificationConfig.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'UPDATE_NOTIF_CONFIG', module: 'NotificationConfig', referenceId: 'default' });
    res.json({ ok: true, message: 'Notification config saved.' });
  } catch (err) {
    console.error('[notifConfig] save', err);
    res.status(500).json({ ok: false, message: 'Save failed.' });
  }
}
