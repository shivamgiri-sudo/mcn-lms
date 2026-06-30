import { v4 as uuidv4 } from 'uuid';
import { prisma } from './db.js';

const TTL = parseInt(process.env.SESSION_TTL_SECONDS || '21600', 10);

export async function createSession(userId, userType) {
  const token = `${uuidv4()}-${uuidv4()}`;
  const expiresAt = new Date(Date.now() + TTL * 1000);

  await prisma.portalSession.create({
    data: { token, userId, userType, expiresAt },
  });

  return token;
}

export async function getSession(token) {
  if (!token) return null;
  const session = await prisma.portalSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function deleteSession(token) {
  await prisma.portalSession.deleteMany({ where: { token } });
}

export async function deleteAllSessions(userId) {
  await prisma.portalSession.deleteMany({ where: { userId } });
}

export async function cleanExpiredSessions() {
  await prisma.portalSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
