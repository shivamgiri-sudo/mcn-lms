import { randomBytes } from 'crypto';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { loadMapping } from '../utils/hrmsConfig.js';
import { queryHrms } from '../utils/hrmsDb.js';
import { generateSalt, hashPassword, normalize } from '../utils/hash.js';
import { autoAssignModulesForNewUser } from '../services/independentModules.js';

const HRMS_DB = process.env.HRMS_DB_NAME || 'mas_hrms';

function mapRow(item, cols) {
  const row = {};
  for (const [target, source] of Object.entries(cols)) {
    row[target] = item[source] ?? null;
  }
  return row;
}

function statusToBool(val) {
  if (val === undefined || val === null) return true;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const s = String(val).toLowerCase();
  return !['0', 'false', 'inactive', 'no'].includes(s);
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function cleanEmail(value) {
  return clean(value)?.toLowerCase() || null;
}

function cleanMobile(value) {
  return String(value ?? '').replace(/\D/g, '').slice(-10) || null;
}

function quoteIdentifier(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(text)) throw new Error(`Unsafe HRMS identifier: ${text || '(empty)'}`);
  return `\`${text}\``;
}

function temporaryCredential() {
  return randomBytes(12).toString('base64url');
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function detectTables() {
  const rows = await queryHrms(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [HRMS_DB]
  );
  return rows.map(r => r.TABLE_NAME);
}

async function detectColumns(table) {
  const rows = await queryHrms(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [HRMS_DB, table]
  );
  return rows.map(r => r.COLUMN_NAME);
}

async function tryGuessConfig(tableName, cols) {
  const cl = cols.map(c => c.toLowerCase());
  const guess = { source: tableName, cols: {} };
  const colMap = {
    name: ['name', 'title', 'label', 'branch_name', 'department_name', 'designation_title', 'branch', 'dept_name', 'desig_name'],
    code: ['code', 'branch_code', 'short_code', 'shortname', 'key'],
    city: ['city', 'location', 'town'],
    state: ['state', 'province', 'region'],
    title: ['title', 'name', 'designation', 'designation_title', 'role'],
    active: ['active', 'status', 'is_active', 'enabled', 'isactive', 'flag'],
  };
  for (const [target, candidates] of Object.entries(colMap)) {
    const found = cl.find(c => candidates.includes(c));
    if (found) guess.cols[target] = found;
  }
  return guess;
}

async function syncFromHRMS(entity, reqUserId) {
  const mapping = loadMapping(); const cfg = mapping[entity]; if (!cfg) throw new Error(`Unknown entity: ${entity}`);

  const tables = await detectTables();
  const sourceTable = tables.find(t => t.toLowerCase() === cfg.table) ||
    tables.find(t => t.toLowerCase().includes(entity)) ||
    tables.find(t => t.toLowerCase().includes(cfg.table));

  if (!sourceTable) {
    const all = tables.join(', ');
    throw new Error(`Table '${cfg.table}' not found in ${HRMS_DB}. Available tables: ${all || '(empty)'}`);
  }

  const rows = await queryHrms(`SELECT * FROM \`${sourceTable}\``);
  if (!rows || rows.length === 0) {
    return { synced: 0, skipped: 0, errors: [], message: `No rows found in ${HRMS_DB}.${sourceTable}` };
  }

  const cols = mapRow(rows[0], cfg.cols);
  const nameKey = entity === 'branch' ? 'branchName' : entity === 'designation' ? 'title' : 'name';
  const nameCol = cfg.cols[nameKey === 'branchName' ? 'name' : nameKey] || cfg.cols.name;
  if (!nameCol) throw new Error(`Cannot determine name column for ${entity}`);

  let synced = 0, skipped = 0, errors = [];
  for (const row of rows) {
    try {
      const name = String(row[nameCol] || '').trim();
      if (!name) { skipped++; continue; }
      const active = statusToBool(row[cfg.cols.active]);

      const data = {};
      if (entity === 'branch') {
        data.branchName = name;
        data.branchCode = row[cfg.cols.code] ? String(row[cfg.cols.code]) : null;
        data.city = row[cfg.cols.city] ? String(row[cfg.cols.city]) : null;
        data.state = row[cfg.cols.state] ? String(row[cfg.cols.state]) : null;
        data.active = active;
        await prisma.branchMaster.upsert({
          where: { branchName: name },
          create: data,
          update: data,
        });
      } else if (entity === 'department') {
        data.name = name;
        data.active = active;
        await prisma.departmentMaster.upsert({
          where: { name },
          create: data,
          update: data,
        });
      } else if (entity === 'designation') {
        data.title = name;
        data.active = active;
        await prisma.designationMaster.upsert({
          where: { title: name },
          create: data,
          update: data,
        });
      }
      synced++;
    } catch (err) {
      errors.push({ name: row[nameCol] || '?', error: err.message });
    }
  }

  await audit({ userIdentity: reqUserId, userRole: 'Admin', action: 'HRMS_SYNC', module: 'Organization', referenceId: entity, details: `Synced ${synced}, skipped ${skipped}, errors ${errors.length}` });
  return { synced, skipped, errors, message: `Synced ${synced} ${entity}(s) from ${HRMS_DB}.${sourceTable}. Skipped ${skipped}.` };
}

export async function syncBranches(req, res) {
  try {
    const result = await syncFromHRMS('branch', req.userId);
    res.json({ ok: true, message: result.message, synced: result.synced, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
}

export async function syncDepartments(req, res) {
  try {
    const result = await syncFromHRMS('department', req.userId);
    res.json({ ok: true, message: result.message, synced: result.synced, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
}

export async function syncDesignations(req, res) {
  try {
    const result = await syncFromHRMS('designation', req.userId);
    res.json({ ok: true, message: result.message, synced: result.synced, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
}

export async function syncProcessLob(req, res) {
  try {
    const mapping = loadMapping();
    const cfg = mapping.processlob;
    if (!cfg) throw new Error('Process/LOB mapping not configured. Save mapping config in Organization tab.');

    const tables = await detectTables();
    const sourceTable = tables.find(t => t.toLowerCase() === cfg.table) ||
      tables.find(t => t.toLowerCase().includes('process')) ||
      tables.find(t => t.toLowerCase().includes('lob'));

    if (!sourceTable) {
      const all = tables.join(', ');
      throw new Error(`Table '${cfg.table}' not found in ${HRMS_DB}. Available tables: ${all || '(empty)'}`);
    }

    const rows = await queryHrms(`SELECT * FROM \`${sourceTable}\``);
    if (!rows || rows.length === 0) {
      return res.json({ ok: true, synced: 0, skipped: 0, errors: [], message: `No rows found in ${HRMS_DB}.${sourceTable}` });
    }

    const processCol = cfg.cols.process || 'process';
    const lobCol = cfg.cols.lob || 'lob';
    const activeCol = cfg.cols.active || 'active';
    let synced = 0, skipped = 0, errors = [];

    for (const row of rows) {
      try {
        const process = String(row[processCol] || '').trim();
        const lob = String(row[lobCol] || '').trim();
        if (!process || !lob) { skipped++; continue; }
        const active = statusToBool(row[activeCol]);
        await prisma.processLobMaster.upsert({
          where: { process_lob: { process, lob } },
          create: { process, lob, active },
          update: { active },
        });
        synced++;
      } catch (err) {
        errors.push({ name: row[processCol] || '?', error: err.message });
      }
    }

    await audit({ userIdentity: req.userId, userRole: 'Admin', action: 'HRMS_SYNC', module: 'ProcessLOB', referenceId: 'processlob', details: `Synced ${synced}, skipped ${skipped}, errors ${errors.length}` });
    res.json({ ok: true, message: `Synced ${synced} process/LOB pair(s) from ${HRMS_DB}.${sourceTable}. Skipped ${skipped}.`, synced, skipped, errors });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
}

export async function syncEmployees(req, res) {
  try {
    const mapping = loadMapping();
    const cfg = mapping.employee;
    if (!cfg?.table || !cfg?.cols?.employeeId || !cfg?.cols?.name) {
      throw new Error('Employee mapping must include table, employeeId and name columns.');
    }

    const dryRun = req.query?.dryRun === '1' || req.body?.dryRun === true;
    const limit = Math.min(Math.max(Number.parseInt(req.body?.limit || req.query?.limit || '200', 10) || 200, 1), 1000);
    const since = clean(req.body?.since || req.query?.since);
    const tables = await detectTables();
    const sourceTable = tables.find(t => t.toLowerCase() === cfg.table.toLowerCase()) ||
      tables.find(t => t.toLowerCase().includes('employee')) ||
      tables.find(t => t.toLowerCase().includes('staff'));

    if (!sourceTable) {
      const all = tables.join(', ');
      throw new Error(`Table '${cfg.table}' not found in ${HRMS_DB}. Available tables: ${all || '(empty)'}`);
    }

    const selectCols = [...new Set(Object.values(cfg.cols).filter(Boolean))];
    const sourceColumns = await detectColumns(sourceTable);
    const missing = selectCols.filter(col => !sourceColumns.includes(col));
    if (missing.length) throw new Error(`Employee mapping columns not found in ${HRMS_DB}.${sourceTable}: ${missing.join(', ')}`);

    const where = [];
    const params = [];
    if (cfg.cols.active) where.push(`(${quoteIdentifier(cfg.cols.active)} IS NULL OR ${quoteIdentifier(cfg.cols.active)} NOT IN ('0','false','inactive','no','Deleted','deleted'))`);
    if (since && cfg.cols.updatedAt && sourceColumns.includes(cfg.cols.updatedAt)) {
      where.push(`${quoteIdentifier(cfg.cols.updatedAt)} >= ?`);
      params.push(since);
    }
    params.push(limit);

    const rows = await queryHrms(
      `SELECT ${selectCols.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(sourceTable)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${quoteIdentifier(cfg.cols.employeeId)} ASC LIMIT ?`,
      params,
    );

    const results = [];
    for (const row of rows || []) {
      const employeeId = normalize(row[cfg.cols.employeeId]);
      const traineeName = clean(row[cfg.cols.name]);
      if (!employeeId || !traineeName) {
        results.push({ employeeId: employeeId || null, status: 'skipped', reason: 'Missing employee ID or name' });
        continue;
      }

      const existing = await prisma.traineeMaster.findUnique({ where: { employeeId }, select: { employeeId: true } });
      if (existing) {
        results.push({ employeeId, status: 'existing', assignedCount: 0 });
        continue;
      }

      const payload = {
        employeeId,
        lmsId: employeeId,
        traineeName,
        email: cleanEmail(row[cfg.cols.email]),
        mobile: cleanMobile(row[cfg.cols.mobile]),
        branch: clean(row[cfg.cols.branch]),
        process: clean(row[cfg.cols.process]),
        lob: clean(row[cfg.cols.lob]),
        doj: dateOrNull(row[cfg.cols.doj]),
      };
      const designation = clean(row[cfg.cols.designation]);
      const department = clean(row[cfg.cols.department]);
      if (designation) payload.designation = designation;

      if (dryRun) {
        results.push({ employeeId, status: 'would_create', profile: { ...payload, designation, department } });
        continue;
      }

      const tempPassword = temporaryCredential();
      const salt = generateSalt();
      const passwordHash = await hashPassword(tempPassword, salt);

      await prisma.$transaction([
        prisma.traineeMaster.create({
          data: {
            ...payload,
            status: 'Active',
            onboardingStatus: 'Active',
            source: 'HRMS Sync',
            empIdType: 'PERMANENT',
            createdBy: req.userId,
          },
        }),
        prisma.userMaster.create({
          data: {
            employeeId,
            passwordHash,
            salt,
            traineeName,
            email: payload.email,
            mobile: payload.mobile,
            branch: payload.branch,
            process: payload.process,
            lob: payload.lob,
            active: true,
            forcePasswordReset: true,
          },
        }),
      ]);

      const autoAssignments = await autoAssignModulesForNewUser({
        employeeId,
        branch: payload.branch,
        process: payload.process,
        lob: payload.lob,
        designation,
        createdBy: req.userId,
      });
      const assignedCount = autoAssignments.filter(item => item.assigned).length;

      await audit({
        userIdentity: req.userId,
        userRole: 'Admin',
        action: 'HRMS_EMPLOYEE_PROVISION',
        module: 'HRMS',
        referenceId: employeeId,
        newValue: { assignedCount, branch: payload.branch, process: payload.process, lob: payload.lob, designation, department },
      });
      results.push({ employeeId, status: 'created', assignedCount, autoAssignments });
    }

    const summary = {
      scanned: rows.length,
      created: results.filter(item => item.status === 'created').length,
      existing: results.filter(item => item.status === 'existing').length,
      skipped: results.filter(item => item.status === 'skipped').length,
      wouldCreate: results.filter(item => item.status === 'would_create').length,
      assigned: results.reduce((sum, item) => sum + (item.assignedCount || 0), 0),
      dryRun,
    };

    await audit({
      userIdentity: req.userId,
      userRole: 'Admin',
      action: dryRun ? 'HRMS_EMPLOYEE_SYNC_DRY_RUN' : 'HRMS_EMPLOYEE_SYNC',
      module: 'HRMS',
      referenceId: sourceTable,
      details: `Scanned ${summary.scanned}, created ${summary.created}, assigned ${summary.assigned}`,
      newValue: summary,
    });
    return res.json({ ok: true, message: dryRun ? 'HRMS employee sync dry run complete.' : 'HRMS employee sync complete.', summary, results });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err.message });
  }
}

export async function provisionHrmsEmployees({ dryRun = false, limit = 200, since = null, userId = 'hrms-worker' } = {}) {
  let payload = null;
  const req = {
    query: dryRun ? { dryRun: '1', limit, since } : { limit, since },
    body: { dryRun, limit, since },
    userId,
  };
  const res = {
    json(value) {
      payload = value;
      return value;
    },
    status(code) {
      return {
        json(value) {
          const error = new Error(value?.message || `HRMS employee provisioning failed with HTTP ${code}`);
          error.statusCode = code;
          error.payload = value;
          throw error;
        },
      };
    },
  };
  await syncEmployees(req, res);
  return payload;
}

export async function detectHRMSTables(req, res) {
  try {
    const tables = await detectTables();
    const result = [];
    for (const table of tables) {
      const cols = await detectColumns(table);
      const guess = await tryGuessConfig(table, cols);
      result.push({ table, columns: cols, guess });
    }
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message });
  }
}

export async function hrmsStatus(req, res) {
  try {
    const tables = await detectTables();
    res.json({
      ok: true,
      data: {
        database: HRMS_DB,
        reachable: true,
        tables: tables.length,
        tablesList: tables,
        mapped: loadMapping(),
      },
    });
  } catch (err) {
    res.json({
      ok: false,
      message: `Cannot reach ${HRMS_DB}: ${err.message}`,
      data: { database: HRMS_DB, reachable: false, tables: 0, tablesList: [] },
    });
  }
}
