export function normalizeIltAttendanceRequest(req, _res, next) {
  const isAttendanceWrite = req.method === 'PUT'
    && /^\/(coordinator|admin)\/sessions\/[^/]+\/attendance\/[^/]+\/?$/.test(req.path);
  if (isAttendanceWrite && String(req.body?.attendanceStatus || '').toUpperCase() === 'ABSENT') {
    req.body = { ...(req.body || {}), attendedMinutes: 0, checkinAt: null, checkoutAt: null };
  }
  next();
}
