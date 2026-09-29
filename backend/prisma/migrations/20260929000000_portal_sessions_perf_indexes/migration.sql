-- Performance indexes for portal_sessions under high concurrency (1000+ users).
--
-- Problem: with 100+ concurrent users every authenticated request hit the DB
-- for a session lookup (WHERE token IN (?,?)) and a revoke/touch (WHERE user_id = ?).
-- Without indexes on user_id+user_type these were full-table scans that grew
-- linearly with session history and exhausted the connection pool.

-- Index for revokeSessionById scan (WHERE id = ?) — covered by PK, no change.

-- Index for deleteAllSessions / listUserSessions (WHERE user_id = ? AND user_type = ?)
-- and for the cleanExpiredSessions sweep (WHERE revoked_at IS NULL AND expires_at < ...).
ALTER TABLE portal_sessions
  ADD INDEX IF NOT EXISTS idx_portal_sessions_user
    (user_id, user_type, revoked_at, expires_at);

-- Partial-style index on active sessions for expiry cleanup
-- (MySQL doesn't support partial indexes, so we include revoked_at to allow
-- the optimizer to skip revoked rows via index range scan).
ALTER TABLE portal_sessions
  ADD INDEX IF NOT EXISTS idx_portal_sessions_expires
    (revoked_at, expires_at, absolute_expires_at);
