import { prisma } from '../utils/db.js';
import { xlsxRes } from '../utils/xlsx.js';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PREVIEW_LIMIT = 5000;
const MAX_RANGE_DAYS = 366;

const istDate = (v) => new Date(new Date(v).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const istTime = (v) => new Date(new Date(v).getTime() + IST_OFFSET_MS).toISOString().slice(11, 19);
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const istDayStart = (ymd) => new Date(`${ymd}T00:00:00+05:30`);

function weekStart(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

function filtersFrom(req) {
  return {
    process: String(req.query?.process || '').trim(),
    branch: req.userBranch || null,
  };
}

// Trainee-side WHERE shared by both reports. `t` is trainee_master.
function traineeScope({ process, branch }, params) {
  let sql = " AND t.status <> 'Deleted'";
  if (process) { sql += ' AND t.process = ?'; params.push(process); }
  if (branch) { sql += ' AND t.branch = ?'; params.push(branch); }
  return sql;
}

function send(res, req, { filename, sheet, headers, rows, preview }) {
  if (String(req.query?.format || '').toLowerCase() === 'xlsx') {
    return xlsxRes(res, filename, sheet, headers, rows);
  }
  const truncated = preview.length > PREVIEW_LIMIT;
  return res.json({ ok: true, data: { headers, rows: preview.slice(0, PREVIEW_LIMIT), total: preview.length, truncated } });
}

// ── 1. Training Completion Report ────────────────────────────────────────────
// One row per user per assigned training: classroom courses (trainee_classroom_map)
// and Independent Modules (assigned_modules, expanded to users the same way the
// Independent Module Reading Report does). A module counts as Completed only when
// every active content item in it is Completed.
export async function exportTrainingCompletion(req, res) {
  try {
    const f = filtersFrom(req);
    const status = String(req.query?.status || '').trim();

    const cParams = [];
    const classroomRows = await prisma.$queryRawUnsafe(
      `SELECT t.employee_id AS employeeId, t.trainee_name AS traineeName, t.process,
              cm.classroom_name AS trainingName,
              ccr.status AS ccrStatus, ccr.completion_pct AS pct,
              MAX(p.completed_at) AS completedAt
         FROM trainee_classroom_map m
         INNER JOIN trainee_master t ON t.employee_id = m.employee_id
         INNER JOIN classroom_master cm ON cm.classroom_id = m.classroom_id
         LEFT JOIN course_completion_report ccr
                ON ccr.employee_id = m.employee_id AND ccr.classroom_id = m.classroom_id
         LEFT JOIN content_progress p
                ON p.employee_id = m.employee_id AND p.classroom_id = m.classroom_id AND p.completion_status = 'Completed'
        WHERE m.active = 1${traineeScope(f, cParams)}
        GROUP BY t.employee_id, t.trainee_name, t.process, cm.classroom_name, ccr.status, ccr.completion_pct`,
      ...cParams,
    );

    const mParams = [];
    const moduleRows = await prisma.$queryRawUnsafe(
      `SELECT t.employee_id AS employeeId, t.trainee_name AS traineeName, t.process,
              im.module_name AS trainingName,
              COUNT(DISTINCT c.repository_content_id) AS totalContents,
              COUNT(DISTINCT CASE WHEN p.completion_status = 'Completed' THEN c.repository_content_id END) AS doneContents,
              MAX(p.completed_at) AS completedAt
         FROM assigned_modules a
         INNER JOIN independent_module_master im ON im.module_id = a.module_id AND im.status = 'Active'
         INNER JOIN independent_module_content_map c ON c.module_id = a.module_id AND c.active = 1
         INNER JOIN trainee_master t
                 ON ((a.assigned_to_type = 'individual' AND t.employee_id = a.assigned_to)
                  OR (a.assigned_to_type = 'batch'      AND t.batch_no    = a.assigned_to)
                  OR (a.assigned_to_type = 'process'    AND t.process     = a.assigned_to)
                  OR (a.assigned_to_type = 'branch'     AND t.branch      = a.assigned_to)
                  OR  a.assigned_to_type = 'company')
         LEFT JOIN content_progress p
                ON p.employee_id = t.employee_id AND p.content_id = c.repository_content_id
        WHERE a.active = 1${traineeScope(f, mParams)}
        GROUP BY t.employee_id, t.trainee_name, t.process, im.module_id, im.module_name`,
      ...mParams,
    );

    const all = [
      ...classroomRows.map(r => {
        const done = r.ccrStatus === 'Completed';
        return { ...r, trainingName: `${r.trainingName} (Course)`, done, completedAt: done ? r.completedAt : null };
      }),
      ...moduleRows.map(r => {
        const total = Number(r.totalContents || 0);
        const done = total > 0 && Number(r.doneContents || 0) >= total;
        return { ...r, trainingName: `${r.trainingName} (Module)`, done, completedAt: done ? r.completedAt : null };
      }),
    ]
      .filter(r => !status || (status === 'Completed') === r.done)
      .sort((a, b) => String(a.process || '').localeCompare(String(b.process || ''))
        || String(a.traineeName || '').localeCompare(String(b.traineeName || ''))
        || a.trainingName.localeCompare(b.trainingName));

    const headers = ['Employee Name', 'Employee ID', 'Process', 'Assigned Training', 'Completion Date', 'Status'];
    const rows = all.map(r => [
      r.traineeName || '', r.employeeId, r.process || '', r.trainingName,
      r.completedAt ? istDate(r.completedAt) : '', r.done ? 'Completed' : 'Pending',
    ]);
    return send(res, req, {
      filename: `training-completion-${istDate(new Date())}.xlsx`, sheet: 'Training Completion', headers, rows, preview: rows,
    });
  } catch (err) {
    console.error('[lmsReports] training completion failed:', err);
    return res.status(500).json({ ok: false, message: 'Report failed.' });
  }
}

// ── 2. User On-Time Rate Report ──────────────────────────────────────────────
// Active time = sum of accepted content heartbeat seconds (video_watch_log), the
// same signal attendance inference uses; login time = first successful trainee
// LOGIN of the day. Days are bucketed in IST. Weekly/monthly roll the daily rows up.
export async function exportUserActiveTime(req, res) {
  try {
    const f = filtersFrom(req);
    const period = ['daily', 'weekly', 'monthly'].includes(req.query?.period) ? req.query.period : 'daily';
    const today = istDate(new Date());
    const from = isYmd(String(req.query?.from || '')) ? String(req.query.from) : today;
    const to = isYmd(String(req.query?.to || '')) ? String(req.query.to) : today;
    if (to < from) return res.status(400).json({ ok: false, message: '"To" date cannot be before "From" date.' });
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_RANGE_DAYS) {
      return res.status(400).json({ ok: false, message: `Date range cannot exceed ${MAX_RANGE_DAYS} days.` });
    }
    const start = istDayStart(from);
    const end = new Date(istDayStart(to).getTime() + DAY_MS);

    const aParams = [start, end];
    const active = await prisma.$queryRawUnsafe(
      `SELECT t.employee_id AS employeeId, t.trainee_name AS traineeName, t.process,
              DATE_FORMAT(DATE_ADD(w.created_at, INTERVAL 330 MINUTE), '%Y-%m-%d') AS d,
              SUM(w.seconds_delta) AS secs
         FROM video_watch_log w
         INNER JOIN trainee_master t ON t.employee_id = w.employee_id
        WHERE w.created_at >= ? AND w.created_at < ?${traineeScope(f, aParams)}
        GROUP BY t.employee_id, t.trainee_name, t.process, d`,
      ...aParams,
    );
    const lParams = [start, end];
    const logins = await prisma.$queryRawUnsafe(
      `SELECT t.employee_id AS employeeId, t.trainee_name AS traineeName, t.process,
              DATE_FORMAT(DATE_ADD(l.created_at, INTERVAL 330 MINUTE), '%Y-%m-%d') AS d,
              MIN(l.created_at) AS firstLogin
         FROM login_session_log l
         INNER JOIN trainee_master t ON t.employee_id = l.user_id
        WHERE l.user_type = 'trainee' AND l.action = 'LOGIN' AND l.status = 'Success'
          AND l.created_at >= ? AND l.created_at < ?${traineeScope(f, lParams)}
        GROUP BY t.employee_id, t.trainee_name, t.process, d`,
      ...lParams,
    );

    // Merge to one entry per user per day.
    const days = new Map();
    const entry = (r) => {
      const k = `${r.employeeId}|${r.d}`;
      if (!days.has(k)) days.set(k, { employeeId: r.employeeId, name: r.traineeName || '', process: r.process || '', d: r.d, secs: 0, firstLogin: null });
      return days.get(k);
    };
    active.forEach(r => { entry(r).secs += Number(r.secs || 0); });
    logins.forEach(r => { entry(r).firstLogin = r.firstLogin; });

    const bucketKey = (d) => (period === 'daily' ? d : period === 'weekly' ? weekStart(d) : d.slice(0, 7));
    const buckets = new Map();
    for (const day of days.values()) {
      const key = `${day.employeeId}|${bucketKey(day.d)}`;
      const b = buckets.get(key) || { ...day, label: bucketKey(day.d), secs: 0, firstLogin: null, daysActive: 0 };
      b.secs += day.secs;
      if (day.secs > 0) b.daysActive += 1;
      if (day.firstLogin && (!b.firstLogin || new Date(day.firstLogin) < new Date(b.firstLogin))) b.firstLogin = day.firstLogin;
      buckets.set(key, b);
    }

    const periodLabel = (b) => {
      if (period === 'daily') return b.label;
      if (period === 'monthly') return b.label;
      const endOfWeek = new Date(new Date(`${b.label}T00:00:00Z`).getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
      return `${b.label} to ${endOfWeek}`;
    };
    const headers = period === 'daily'
      ? ['Employee Name', 'Employee ID', 'Process', 'Date', 'Login Time', 'Total Active Time (min)']
      : ['Employee Name', 'Employee ID', 'Process', period === 'weekly' ? 'Week' : 'Month', 'First Login Time', 'Days Active', 'Total Active Time (min)'];
    const rows = [...buckets.values()]
      .sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name))
      .map(b => {
        const mins = Math.round((b.secs / 60) * 10) / 10;
        const login = b.firstLogin ? (period === 'daily' ? istTime(b.firstLogin) : `${istDate(b.firstLogin)} ${istTime(b.firstLogin)}`) : '';
        return period === 'daily'
          ? [b.name, b.employeeId, b.process, periodLabel(b), login, mins]
          : [b.name, b.employeeId, b.process, periodLabel(b), login, b.daysActive, mins];
      });
    return send(res, req, {
      filename: `user-on-time-rate-${period}-${from}-to-${to}.xlsx`, sheet: 'User On-Time Rate', headers, rows, preview: rows,
    });
  } catch (err) {
    console.error('[lmsReports] user active time failed:', err);
    return res.status(500).json({ ok: false, message: 'Report failed.' });
  }
}
