import { prisma } from '../utils/db.js';

export async function syncIltSessionStates() {
  const started = await prisma.$executeRawUnsafe(
    `UPDATE ilt_session
        SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, UTC_TIMESTAMP(3))
      WHERE status = 'PUBLISHED'
        AND start_at <= UTC_TIMESTAMP(3)`,
  );

  const expiredCheckins = await prisma.$executeRawUnsafe(
    `UPDATE ilt_session
        SET checkin_code_hash = NULL
      WHERE checkin_code_hash IS NOT NULL
        AND checkin_close_at IS NOT NULL
        AND checkin_close_at < UTC_TIMESTAMP(3)`,
  );

  const overdueFinalization = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
       FROM ilt_session
      WHERE status = 'IN_PROGRESS'
        AND end_at < UTC_TIMESTAMP(3)`,
  );

  return {
    started: Number(started || 0),
    expiredCheckins: Number(expiredCheckins || 0),
    awaitingFinalization: Number(overdueFinalization[0]?.count || 0),
  };
}
