import { createHash } from 'crypto';
import { audit } from '../utils/audit.js';

const GENERIC_MESSAGE = 'If a matching account exists, the recovery request has been recorded for secure verification.';

function referenceFor(value) {
  return createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex').slice(0, 20);
}

async function recordRecoveryRequest({ identifier, userRole, source }) {
  await audit({
    userIdentity: 'anonymous-recovery-request',
    userRole,
    action: 'PASSWORD_RECOVERY_REQUESTED',
    module: 'Auth',
    referenceId: referenceFor(identifier),
    newValue: { recoveryMode: 'secure-verification-required' },
    source,
  });
}

/**
 * Containment handler used until the migration-backed, single-use reset-token
 * flow is deployed. It never changes credentials and never reveals whether an
 * account exists.
 */
export async function requestTraineeRecovery(req, res) {
  try {
    await recordRecoveryRequest({
      identifier: req.body?.identifier,
      userRole: 'Trainee',
      source: 'Trainee Portal',
    });
    return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
  } catch (err) {
    console.error('[AUTH] Trainee recovery request failed:', err.message);
    return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
  }
}

export async function requestAdminRecovery(req, res) {
  try {
    await recordRecoveryRequest({
      identifier: req.body?.adminId,
      userRole: 'Admin',
      source: 'Admin Portal',
    });
    return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
  } catch (err) {
    console.error('[AUTH] Admin recovery request failed:', err.message);
    return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
  }
}

export async function requestCoordinatorRecovery(req, res) {
  try {
    await recordRecoveryRequest({
      identifier: req.body?.loginId,
      userRole: 'Coordinator',
      source: 'Coordinator Portal',
    });
    return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
  } catch (err) {
    console.error('[AUTH] Coordinator recovery request failed:', err.message);
    return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
  }
}
