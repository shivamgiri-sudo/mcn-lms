import { createHash, randomBytes } from 'crypto';
import { prisma } from './db.js';

const TTL = Number.parseInt(process.env.SESSION_TTL_SECONDS || '21600', 10);

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function sessionKeys(token) {
  const raw = String(token || '').trim();
  if (!raw) return [];
  return [hashSessionToken(raw), raw];
}

export async function createSession(userId, userType) {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL * 1000);

  await prisma.portalSession.create({
    data: { token: hashSessionToken(token), userId, userType, expiresAt },
  });

  return token;
}

export async function getSession(token) {
  const keys = sessionKeys(token);
  if (!keys.length) return null;

  const session = await prisma.portalSession.findFirst({ where: { token: { in: keys } } });
  if (!session || session.expiresAt < new Date()) return null;

  // One-time compatibility migration for sessions created before token hashing.
  if (session.token === String(token).trim()) {
    const fingerprint = hashSessionToken(token);
    try {
      return await prisma.portalSession.update({
        where: { id: session.id },
        data: { token: fingerprint },
      });
    } catch {
      // If another request migrated the token first, resolve the hashed row.
      return prisma.portalSession.findUnique({ where: { token: fingerprint } });
    }
  }

  return session;
}

export async function deleteSession(token) {
  const keys = sessionKeys(token);
  if (!keys.length) return;
  await prisma.portalSession.deleteMany({ where: { token: { in: keys } } });
}

export async function deleteAllSessions(userId) {
  await prisma.portalSession.deleteMany({ where: { userId } });
}

export async function cleanExpiredSessions() {
  await prisma.portalSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
