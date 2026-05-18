import { prisma } from '../utils/db.js';

export async function requireSession(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ ok: false, message: 'Unauthorized' });

  const session = await prisma.portalSession.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    return res.status(401).json({ ok: false, message: 'Session expired. Please login again.' });
  }

  req.session = session;
  req.userId = session.userId;
  req.userType = session.userType;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.userType)) {
      return res.status(403).json({ ok: false, message: 'Access denied.' });
    }
    next();
  };
}
