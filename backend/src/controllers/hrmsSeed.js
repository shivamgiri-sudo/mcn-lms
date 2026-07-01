import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { loadMapping } from '../utils/hrmsConfig.js';
import { queryHrms } from '../utils/hrmsDb.js';

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
