import { prisma } from './db.js';

export async function audit({ userIdentity, userRole, action, module, referenceId, oldValue, newValue, status = 'Success', errorDetails, source = 'Portal' }) {
  try {
    await prisma.auditLog.create({
      data: {
        userIdentity: String(userIdentity || 'system'),
        userRole: String(userRole || 'system'),
        action: String(action),
        module: module || null,
        referenceId: referenceId || null,
        oldValue: oldValue ? JSON.stringify(oldValue) : null,
        newValue: newValue ? JSON.stringify(newValue) : null,
        status,
        errorDetails: errorDetails || null,
        source,
      },
    });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}
