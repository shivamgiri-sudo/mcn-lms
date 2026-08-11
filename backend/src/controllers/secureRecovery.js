import { createHash, randomBytes, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { sendEmail, sendSms } from '../utils/notify.js';
import { generateSalt, hashPassword, normalize } from '../utils/hash.js';

const GENERIC_MESSAGE = 'If a matching account exists, a secure recovery link will be sent to its registered channel.';
const RESET_TTL_MINUTES = Math.max(5, Math.min(30, Number.parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '15', 10)));
const ALLOWED_TYPES = new Set(['trainee', 'coordinator']);

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function identifierReference(value) {
  return sha256(String(value || '').trim().toLowerCase()).slice(0, 20);
}

function requestIpHash(req) {
  const secret = String(process.env.SESSION_SECRET || 'lms-recovery-audit');
  return sha256(`${secret}:${req.ip || req.socket?.remoteAddress || 'unknown'}`);
}

function passwordError(password) {
  const value = String(password || '');
  if (value.length < 10) return 'Password must contain at least 10 characters.';
  if (value.length > 128) return 'Password cannot exceed 128 characters.';
  if (!/[a-z]/.test(value)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Password must include an uppercase letter.';
  if (!/\d/.test(value)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must include a special character.';
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const blocked = new Set(['password123', 'admin1234', 'welcome123', 'qwerty1234', 'changeme123']);
  if (blocked.has(normalized)) return 'Choose a less predictable password.';
  return null;
}

function frontendOrigin() {
  const configured = String(process.env.FRONTEND_URL || '').split(',')[0].trim();
  if (!configured) throw new Error('FRONTEND_URL is not configured.');
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('FRONTEND_URL must use HTTP or HTTPS.');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('FRONTEND_URL must use HTTPS in production.');
  return url.origin;
}

async function cleanupTokens() {
  await prisma.$executeRaw`
    DELETE FROM password_reset_tokens
    WHERE expires_at < NOW(3)
       OR (used_at IS NOT NULL AND used_at < DATE_SUB(NOW(3), INTERVAL 7 DAY))
  `;
}

async function findTrainee(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const mobile = raw.replace(/\D/g, '').slice(-10);
  const email = raw.includes('@') ? raw.toLowerCase() : null;
  const employeeId = normalize(raw);

  let user = await prisma.userMaster.findFirst({
    where: {
      active: true,
      OR: [
        { employeeId },
        ...(email ? [{ email }] : []),
        ...(mobile.length === 10 ? [{ mobile: { endsWith: mobile } }] : []),
      ],
    },
    select: { employeeId: true, traineeName: true, email: true, mobile: true, locked: true },
  });

  if (!user && /^LMS/i.test(raw)) {
    const trainee = await prisma.traineeMaster.findFirst({
      where: { lmsId: raw, status: { not: 'Deleted' } },
      select: { employeeId: true },
    });
    if (trainee) {
      user = await prisma.userMaster.findFirst({
        where: { employeeId: trainee.employeeId, active: true },
        select: { employeeId: true, traineeName: true, email: true, mobile: true, locked: true },
      });
    }
  }

  return user ? {
    userId: user.employeeId,
    userType: 'trainee',
    name: user.traineeName || user.employeeId,
    email: user.email,
    mobile: user.mobile,
  } : null;
}

async function findCoordinator(identifier) {
  const loginId = String(identifier || '').trim();
  if (!loginId) return null;
  const user = await prisma.roleAccessMatrix.findFirst({
    where: { loginId, active: true },
    select: { loginId: true, name: true, email: true, mobile: true, locked: true },
  });
  return user ? {
    userId: user.loginId,
    userType: 'coordinator',
    name: user.name || user.loginId,
    email: user.email,
    mobile: user.mobile,
  } : null;
}

async function createResetToken(account, req) {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);
  // expiresAt is used only for the audit log — SQL uses DATE_ADD(NOW(3), ...) so that
  // expires_at is stored in MySQL server local time (IST), consistent with every
  // NOW(3) comparison in UPDATE/SELECT. Passing a JS Date serialises as UTC, which
  // causes the UPDATE's "AND expires_at > NOW(3)" to fail immediately on IST servers.
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      DELETE FROM password_reset_tokens
      WHERE user_type = ${account.userType}
        AND user_id = ${account.userId}
        AND used_at IS NULL
    `;
    await tx.$executeRaw`
      INSERT INTO password_reset_tokens
        (id, token_hash, user_id, user_type, expires_at, used_at, request_ip_hash, created_at)
      VALUES
        (${randomUUID()}, ${tokenHash}, ${account.userId}, ${account.userType},
         DATE_ADD(NOW(3), INTERVAL ${RESET_TTL_MINUTES} MINUTE),
         NULL, ${requestIpHash(req)}, NOW(3))
    `;
  });

  return { rawToken, tokenHash, expiresAt };
}

async function deliverReset(account, rawToken) {
  const resetUrl = `${frontendOrigin()}/reset-password#token=${encodeURIComponent(rawToken)}&type=${encodeURIComponent(account.userType)}`;
  const attempts = [];

  if (account.email) {
    attempts.push(sendEmail({
      to: account.email,
      subject: 'Secure MCN LMS password recovery',
      html: `<p>Hi <b>${account.name}</b>,</p><p>A password recovery request was received for your MCN LMS account.</p><p><a href="${resetUrl}">Reset your password securely</a></p><p>This link expires in ${RESET_TTL_MINUTES} minutes and can be used only once. If you did not request this, ignore this message and inform your administrator.</p><p>— MCN LMS Security</p>`,
      text: `Hi ${account.name}, reset your MCN LMS password using this one-time link: ${resetUrl}. It expires in ${RESET_TTL_MINUTES} minutes. If you did not request this, contact your administrator.`,
    }));
  }

  if (account.mobile) {
    attempts.push(sendSms({
      mobile: account.mobile,
      message: `MCN LMS secure password reset link (valid ${RESET_TTL_MINUTES} minutes): ${resetUrl}`,
    }));
  }

  if (!attempts.length) return { delivered: false, results: [] };
  const settled = await Promise.allSettled(attempts);
  const results = settled.map(item => {
    if (item.status === 'fulfilled') {
      // A channel can resolve without delivering (disabled, or missing credentials).
      if (!item.value?.ok) console.warn('[AUTH] recovery channel did not deliver:', item.value?.message);
      return item.value;
    }
    // Without this the underlying SMTP/SMS error is lost and the failure is invisible.
    console.error('[AUTH] recovery delivery threw:', item.reason?.response || item.reason?.message || item.reason);
    return { ok: false, message: 'Delivery failed.' };
  });
  return { delivered: results.some(result => result?.ok), results };
}

async function processRecoveryRequest({ identifier, accountType, req, source }) {
  const referenceId = identifierReference(identifier);
  try {
    await cleanupTokens().catch(() => {});
    const account = accountType === 'trainee'
      ? await findTrainee(identifier)
      : await findCoordinator(identifier);

    if (!account) {
      await audit({
        userIdentity: 'anonymous-recovery-request',
        userRole: accountType,
        action: 'PASSWORD_RECOVERY_REQUESTED',
        module: 'Auth',
        referenceId,
        status: 'Accepted',
        newValue: { accountResolved: false },
        source,
      });
      return;
    }

    const { rawToken, tokenHash, expiresAt } = await createResetToken(account, req);
    const delivery = await deliverReset(account, rawToken);
    if (!delivery.delivered) {
      await prisma.$executeRaw`
        DELETE FROM password_reset_tokens WHERE token_hash = ${tokenHash}
      `;
    }

    await audit({
      userIdentity: account.userId,
      userRole: account.userType,
      action: 'PASSWORD_RECOVERY_REQUESTED',
      module: 'Auth',
      referenceId,
      status: delivery.delivered ? 'Success' : 'DeliveryFailed',
      newValue: {
        expiresAt,
        delivered: delivery.delivered,
        channelsAttempted: delivery.results.length,
      },
      source,
    });
  } catch (error) {
    console.error(`[AUTH] ${accountType} recovery request failed:`, error.message);
    await audit({
      userIdentity: 'anonymous-recovery-request',
      userRole: accountType,
      action: 'PASSWORD_RECOVERY_REQUESTED',
      module: 'Auth',
      referenceId,
      status: 'Error',
      errorDetails: 'Recovery processing failed.',
      source,
    });
  }
}

export async function requestTraineeRecovery(req, res) {
  await processRecoveryRequest({
    identifier: req.body?.identifier,
    accountType: 'trainee',
    req,
    source: 'Trainee Portal',
  });
  return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
}

export async function requestCoordinatorRecovery(req, res) {
  await processRecoveryRequest({
    identifier: req.body?.loginId,
    accountType: 'coordinator',
    req,
    source: 'Coordinator Portal',
  });
  return res.status(202).json({ ok: true, message: GENERIC_MESSAGE });
}

export async function requestAdminRecovery(req, res) {
  const referenceId = identifierReference(req.body?.adminId);
  await audit({
    userIdentity: 'anonymous-recovery-request',
    userRole: 'Admin',
    action: 'ADMIN_RECOVERY_REQUIRES_ASSISTED_VERIFICATION',
    module: 'Auth',
    referenceId,
    source: 'Admin Portal',
  });
  return res.status(202).json({
    ok: true,
    message: 'If the administrator account exists, the recovery request has been recorded for assisted identity verification.',
  });
}

export async function completePasswordRecovery(req, res) {
  try {
    const rawToken = String(req.body?.token || '').trim();
    const userType = String(req.body?.userType || '').trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || '');
    if (!rawToken || !ALLOWED_TYPES.has(userType)) {
      return res.status(400).json({ ok: false, message: 'The recovery link is invalid or incomplete.' });
    }
    const policyError = passwordError(newPassword);
    if (policyError) return res.status(400).json({ ok: false, message: policyError });

    const tokenHash = sha256(rawToken);
    // Filter expired and used tokens in SQL using NOW(3) (server local time) so the
    // check is consistent with the UPDATE below. A JS Date comparison is unreliable
    // when expires_at is stored in server local time but Node.js runs in a different
    // timezone (e.g. UTC vs IST).
    const rows = await prisma.$queryRaw`
      SELECT id, user_id, user_type, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND user_type = ${userType}
        AND used_at IS NULL
        AND expires_at > NOW(3)
      LIMIT 1
    `;
    const token = rows?.[0];
    if (!token) {
      return res.status(400).json({ ok: false, message: 'The recovery link is invalid, expired, or already used.' });
    }

    const salt = generateSalt();
    const credentialHash = await hashPassword(newPassword, salt);

    await prisma.$transaction(async tx => {
      const claimed = await tx.$executeRaw`
        UPDATE password_reset_tokens
        SET used_at = NOW(3)
        WHERE id = ${token.id}
          AND used_at IS NULL
          AND expires_at > NOW(3)
      `;
      if (claimed !== 1) throw new Error('RESET_TOKEN_ALREADY_CLAIMED');

      if (userType === 'trainee') {
        const updated = await tx.userMaster.updateMany({
          where: { employeeId: token.user_id, active: true },
          data: {
            passwordHash: credentialHash,
            salt,
            forcePasswordReset: false,
            failedAttempts: 0,
            locked: false,
          },
        });
        if (updated.count !== 1) throw new Error('RECOVERY_ACCOUNT_NOT_FOUND');
      } else {
        const updated = await tx.roleAccessMatrix.updateMany({
          where: { loginId: token.user_id, active: true },
          data: {
            pin: `v1$bcrypt$${salt}$${credentialHash}`,
            failedAttempts: 0,
            locked: false,
          },
        });
        if (updated.count !== 1) throw new Error('RECOVERY_ACCOUNT_NOT_FOUND');
      }

      await tx.$executeRaw`
      UPDATE portal_sessions
         SET revoked_at = COALESCE(revoked_at, NOW(3)),
             revoked_reason = COALESCE(revoked_reason, 'Password recovery completed'),
             elevation_authenticated_at = NULL,
             elevation_expires_at = NULL,
             elevation_reason = NULL,
             updated_at = NOW(3)
       WHERE user_id = ${token.user_id}
         AND revoked_at IS NULL
    `;
      await tx.$executeRaw`
        DELETE FROM password_reset_tokens
        WHERE user_type = ${userType}
          AND user_id = ${token.user_id}
          AND used_at IS NULL
      `;
    });

    await audit({
      userIdentity: token.user_id,
      userRole: userType,
      action: 'PASSWORD_RECOVERY_COMPLETED',
      module: 'Auth',
      referenceId: token.id,
      newValue: { sessionsRevoked: true },
      source: 'Self-Service',
    });

    return res.json({ ok: true, message: 'Password updated successfully. Sign in again using your new password.' });
  } catch (error) {
    if (error.message === 'RESET_TOKEN_ALREADY_CLAIMED') {
      return res.status(409).json({ ok: false, message: 'This recovery link has already been used.' });
    }
    console.error('[AUTH] Password recovery completion failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Password recovery could not be completed.' });
  }
}
