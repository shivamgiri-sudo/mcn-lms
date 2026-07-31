import { createHash, randomBytes, randomUUID } from 'crypto';
import { prisma } from '../utils/db.js';

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function escapeIcs(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

function utcStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldLine(line) {
  const parts = [];
  let remaining = String(line);
  while (remaining.length > 73) {
    parts.push(remaining.slice(0, 73));
    remaining = ` ${remaining.slice(73)}`;
  }
  parts.push(remaining);
  return parts.join('\r\n');
}

function eventBlock(event) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcs(event.uid)}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(event.startAt)}`,
    `DTEND:${utcStamp(event.endAt || new Date(new Date(event.startAt).getTime() + 30 * 60000))}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
  if (event.url) lines.push(`URL:${escapeIcs(event.url)}`);
  if (event.status) lines.push(`STATUS:${escapeIcs(event.status)}`);
  lines.push(`CATEGORIES:${escapeIcs(event.category || 'MCN LMS')}`);
  lines.push('END:VEVENT');
  return lines.map(foldLine).join('\r\n');
}

function safeScope(scope) {
  return ['SELF', 'OWN_BATCH', 'BRANCH', 'COMPANY'].includes(String(scope || '').toUpperCase())
    ? String(scope).toUpperCase()
    : 'SELF';
}

export async function createCalendarFeedToken({ userType, userId, feedScope = 'SELF', branch = '', timezone = 'Asia/Kolkata', label = 'MCN LMS Calendar', expiresAt = null, createdBy }) {
  const token = randomBytes(32).toString('base64url');
  const tokenId = randomUUID();
  const scope = safeScope(feedScope);
  await prisma.$executeRawUnsafe(
    `INSERT INTO calendar_feed_token
       (token_id, user_type, user_id, token_hash, token_prefix,
        feed_scope, branch, timezone, label, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tokenId, String(userType), String(userId), hash(token), token.slice(0, 10),
    scope, String(branch || ''), String(timezone || 'Asia/Kolkata'),
    String(label || 'MCN LMS Calendar').slice(0, 120), expiresAt || null,
    String(createdBy || userId),
  );
  return { tokenId, token, tokenPrefix: token.slice(0, 10), feedScope: scope, expiresAt };
}

export async function listCalendarFeedTokens(userType, userId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT token_id AS tokenId, token_prefix AS tokenPrefix,
            feed_scope AS feedScope, branch, timezone, label,
            expires_at AS expiresAt, revoked_at AS revokedAt,
            last_used_at AS lastUsedAt, created_at AS createdAt
       FROM calendar_feed_token
      WHERE user_type = ? AND user_id = ?
      ORDER BY created_at DESC`,
    String(userType), String(userId),
  );
  return rows;
}

export async function revokeCalendarFeedToken({ tokenId, userType, userId, allowScopeAdmin = false }) {
  const params = [String(tokenId)];
  let ownerSql = '';
  if (!allowScopeAdmin) {
    ownerSql = ' AND user_type = ? AND user_id = ?';
    params.push(String(userType), String(userId));
  }
  const count = await prisma.$executeRawUnsafe(
    `UPDATE calendar_feed_token SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3))
      WHERE token_id = ?${ownerSql}`,
    ...params,
  );
  return { tokenId, revoked: Number(count || 0) > 0 };
}

async function resolveFeed(token) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT token_id AS tokenId, user_type AS userType, user_id AS userId,
            feed_scope AS feedScope, branch, timezone, label,
            expires_at AS expiresAt, revoked_at AS revokedAt
       FROM calendar_feed_token
      WHERE token_hash = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
      LIMIT 1`,
    hash(token),
  );
  return rows[0] || null;
}

async function traineeEvents(feed, from, to) {
  const [ilt, coaching, certifications] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT CONCAT('ilt-', s.session_id) AS uid,
              s.title, s.description, s.start_at AS startAt, s.end_at AS endAt,
              COALESCE(v.room_location, v.venue_name, 'Virtual session') AS location,
              COALESCE(s.virtual_join_url, v.virtual_join_url, '/training-calendar?role=trainee') AS url,
              CASE WHEN e.status IN ('CONFIRMED','ATTENDED') THEN 'CONFIRMED' ELSE 'TENTATIVE' END AS status,
              'Live Training' AS category
         FROM ilt_session_enrollment e
         INNER JOIN ilt_session s ON s.session_id = e.session_id
         LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
        WHERE e.employee_id = ? AND e.status IN ('CONFIRMED','WAITLISTED','ATTENDED')
          AND s.status IN ('PUBLISHED','IN_PROGRESS','COMPLETED')
          AND s.start_at BETWEEN ? AND ?`,
      String(feed.userId), from, to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT CONCAT('coaching-', cs.session_id) AS uid,
              CONCAT('Coaching: ', cp.title) AS title,
              COALESCE(cs.agenda, cp.success_criteria, 'Coaching and development conversation') AS description,
              cs.scheduled_at AS startAt,
              DATE_ADD(cs.scheduled_at, INTERVAL COALESCE(cs.duration_minutes, 30) MINUTE) AS endAt,
              'MCN LMS' AS location, '/development-hub?role=trainee' AS url,
              CASE WHEN cs.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'CONFIRMED' END AS status,
              'Coaching' AS category
         FROM coaching_session cs
         INNER JOIN coaching_plan cp ON cp.plan_id = cs.plan_id
        WHERE cp.employee_id = ? AND cs.status IN ('SCHEDULED','COMPLETED')
          AND cs.scheduled_at BETWEEN ? AND ?`,
      String(feed.userId), from, to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT CONCAT('renewal-', crc.case_id) AS uid,
              CONCAT('Certification renewal: ', ec.certification_type) AS title,
              COALESCE(crc.blocker_reason, 'Complete certification renewal requirements.') AS description,
              crc.due_at AS startAt,
              DATE_ADD(crc.due_at, INTERVAL 30 MINUTE) AS endAt,
              'MCN LMS' AS location, '/development-hub?role=trainee' AS url,
              CASE WHEN crc.status = 'COMPLETED' THEN 'CONFIRMED' ELSE 'TENTATIVE' END AS status,
              'Certification' AS category
         FROM certification_renewal_case crc
         INNER JOIN employee_certification ec ON ec.certification_id = crc.certification_id
        WHERE crc.employee_id = ? AND crc.status IN ('OPEN','IN_PROGRESS','READY','OVERDUE')
          AND crc.due_at BETWEEN ? AND ?`,
      String(feed.userId), from, to,
    ),
  ]);
  return [...ilt, ...coaching, ...certifications];
}

async function coordinatorEvents(feed, from, to) {
  const [ilt, coaching] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT CONCAT('ilt-', s.session_id) AS uid,
              s.title, s.description, s.start_at AS startAt, s.end_at AS endAt,
              COALESCE(v.room_location, v.venue_name, 'Virtual session') AS location,
              COALESCE(s.virtual_join_url, v.virtual_join_url, '/training-calendar?role=coordinator') AS url,
              CASE WHEN s.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'CONFIRMED' END AS status,
              'Live Training' AS category
         FROM ilt_session s
         LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
         LEFT JOIN batch_master b ON b.batch_no = s.batch_no
        WHERE (b.coordinator_login_id = ? OR s.created_by = ?
          OR EXISTS (
            SELECT 1 FROM ilt_session_instructor si
            INNER JOIN ilt_instructor i ON i.instructor_id = si.instructor_id
            WHERE si.session_id = s.session_id AND i.user_id = ?
          ))
          AND s.status IN ('PUBLISHED','IN_PROGRESS','COMPLETED')
          AND s.start_at BETWEEN ? AND ?`,
      String(feed.userId), String(feed.userId), String(feed.userId), from, to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT CONCAT('coaching-', cs.session_id) AS uid,
              CONCAT('Coaching: ', cp.title) AS title,
              COALESCE(cs.agenda, cp.success_criteria, 'Coaching and development conversation') AS description,
              cs.scheduled_at AS startAt,
              DATE_ADD(cs.scheduled_at, INTERVAL COALESCE(cs.duration_minutes, 30) MINUTE) AS endAt,
              'MCN LMS' AS location, '/development-hub?role=coordinator' AS url,
              CASE WHEN cs.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'CONFIRMED' END AS status,
              'Coaching' AS category
         FROM coaching_session cs
         INNER JOIN coaching_plan cp ON cp.plan_id = cs.plan_id
        WHERE cp.owner_id = ? AND cs.status IN ('SCHEDULED','COMPLETED')
          AND cs.scheduled_at BETWEEN ? AND ?`,
      String(feed.userId), from, to,
    ),
  ]);
  return [...ilt, ...coaching];
}

async function scopedAdminEvents(feed, from, to) {
  const params = [from, to];
  let scopeSql = '';
  if (feed.feedScope !== 'COMPANY') {
    scopeSql = ` AND (s.branch = ? OR s.branch = '')`;
    params.push(String(feed.branch || ''));
  }
  return prisma.$queryRawUnsafe(
    `SELECT CONCAT('ilt-', s.session_id) AS uid,
            s.title, s.description, s.start_at AS startAt, s.end_at AS endAt,
            COALESCE(v.room_location, v.venue_name, 'Virtual session') AS location,
            COALESCE(s.virtual_join_url, v.virtual_join_url, '/training-calendar?role=admin') AS url,
            CASE WHEN s.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'CONFIRMED' END AS status,
            'Live Training' AS category
       FROM ilt_session s
       LEFT JOIN ilt_venue v ON v.venue_id = s.venue_id
      WHERE s.start_at BETWEEN ? AND ?${scopeSql}
        AND s.status IN ('PUBLISHED','IN_PROGRESS','COMPLETED')`,
    ...params,
  );
}

async function eventsForFeed(feed, from, to) {
  if (feed.userType === 'trainee') return traineeEvents(feed, from, to);
  if (feed.userType === 'coordinator') return coordinatorEvents(feed, from, to);
  return scopedAdminEvents(feed, from, to);
}

async function logAccess(feed, requestMeta, eventCount, status = 'SUCCESS', errorDetails = null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO calendar_feed_access_log
       (access_id, token_id, ip_hash, user_agent_hash, event_count, status, error_details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), feed.tokenId,
    requestMeta?.ip ? hash(requestMeta.ip) : null,
    requestMeta?.userAgent ? hash(requestMeta.userAgent) : null,
    Number(eventCount || 0), status, errorDetails ? String(errorDetails).slice(0, 10000) : null,
  );
}

export async function generateCalendarFeed(token, requestMeta = {}) {
  const feed = await resolveFeed(token);
  if (!feed) {
    const error = new Error('Calendar feed token is invalid, expired or revoked.');
    error.status = 404;
    throw error;
  }
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  try {
    const events = await eventsForFeed(feed, from, to);
    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Mas CallNet//MCN LMS//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcs(feed.label)}`,
      `X-WR-TIMEZONE:${escapeIcs(feed.timezone || 'Asia/Kolkata')}`,
      ...events.filter(event => event.startAt).map(eventBlock),
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    await Promise.all([
      prisma.$executeRawUnsafe(`UPDATE calendar_feed_token SET last_used_at = UTC_TIMESTAMP(3) WHERE token_id = ?`, feed.tokenId),
      logAccess(feed, requestMeta, events.length),
    ]);
    return { feed, events, calendar };
  } catch (error) {
    await logAccess(feed, requestMeta, 0, 'FAILED', error.message).catch(() => {});
    throw error;
  }
}
