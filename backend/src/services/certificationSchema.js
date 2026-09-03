import { prisma } from '../utils/db.js';

// certification_rule_master predates the Process Quality columns, and this project
// deploys by pulling code rather than running migrations, so the columns are added
// in place at boot. Safe to run repeatedly.
const PQ_COLUMNS = [
  ['pq_required', "TINYINT(1) NOT NULL DEFAULT 0 AFTER external_cert_pass_pct"],
  ['pq_max_error_pct', "DOUBLE NOT NULL DEFAULT 2.5 AFTER pq_required"],
  ['pq_days', "INT NOT NULL DEFAULT 0 AFTER pq_max_error_pct"],
];

async function hasColumn(table, column) {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    table, column,
  );
  return Number(row?.present ?? row?.PRESENT ?? 0) > 0;
}

// Gates are configured per rule as rows rather than columns, so a process can define a
// client certification round, a sales target or an email audit without a schema change.
async function ensureCriterionTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS certification_criterion (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      rule_id VARCHAR(191) NOT NULL,
      criterion_key VARCHAR(100) NOT NULL,
      label VARCHAR(255) NOT NULL,
      measure VARCHAR(30) NOT NULL DEFAULT 'single',
      direction VARCHAR(20) NOT NULL DEFAULT 'at_least',
      target_value DOUBLE NOT NULL DEFAULT 0,
      unit VARCHAR(20) NOT NULL DEFAULT 'percent',
      days INT NOT NULL DEFAULT 0,
      blocks TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_rule_criterion (rule_id, criterion_key),
      INDEX idx_criterion_rule (rule_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// The four gates that used to be columns become ordinary criteria, once per rule. A
// rule that already has criteria is left alone, so admin edits are never overwritten.
async function migrateLegacyGates() {
  const rules = await prisma.$queryRawUnsafe('SELECT * FROM certification_rule_master');
  for (const rule of rules || []) {
    const [existing] = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS total FROM certification_criterion WHERE rule_id = ?', rule.rule_id,
    );
    if (Number(existing?.total ?? existing?.TOTAL ?? 0) > 0) continue;

    const planned = [];
    if (Number(rule.mock_call_required)) {
      planned.push(['mock_call', 'Mock Call', 'single', 'at_least', Number(rule.mock_call_pass_pct || 60), 'percent', 0, 1]);
    }
    if (Number(rule.internal_cert_required)) {
      planned.push(['internal', 'Internal Certification', 'single', 'at_least', Number(rule.internal_cert_pass_pct || 60), 'percent', 0, 1]);
    }
    if (Number(rule.external_cert_required)) {
      planned.push(['external', 'External Certification', 'single', 'at_least', Number(rule.external_cert_pass_pct || 60), 'percent', 0, 1]);
    }
    if (Number(rule.pq_days) > 0) {
      planned.push(['pq', 'PQ Error Rate', 'daily_average', 'at_most', Number(rule.pq_max_error_pct || 2.5), 'percent', Number(rule.pq_days), Number(rule.pq_required) ? 1 : 0]);
    }
    if (!planned.length) continue;

    for (let index = 0; index < planned.length; index += 1) {
      const [key, label, measure, direction, target, unit, days, blocks] = planned[index];
      await prisma.$executeRawUnsafe(
        `INSERT IGNORE INTO certification_criterion
           (id, rule_id, criterion_key, label, measure, direction, target_value, unit, days, blocks, sort_order)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rule.rule_id, key, label, measure, direction, target, unit, days, blocks, index,
      );
    }
    console.log(`[schema] migrated ${planned.length} legacy gate(s) to criteria for ${rule.rule_id}`);
  }
}

export async function ensureCertificationRuleColumns() {
  // An earlier build shipped this as pq_target_pct with a higher-is-better default.
  // PQ is an error rate, so the column is renamed in place rather than duplicated.
  if (await hasColumn('certification_rule_master', 'pq_target_pct')
      && !await hasColumn('certification_rule_master', 'pq_max_error_pct')) {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE certification_rule_master CHANGE COLUMN pq_target_pct pq_max_error_pct DOUBLE NOT NULL DEFAULT 2.5');
    await prisma.$executeRawUnsafe(
      'UPDATE certification_rule_master SET pq_max_error_pct = 2.5 WHERE pq_max_error_pct > 100 OR pq_max_error_pct = 85');
    console.log('[schema] certification_rule_master.pq_target_pct renamed to pq_max_error_pct');
  }
  for (const [column, definition] of PQ_COLUMNS) {
    if (await hasColumn('certification_rule_master', column)) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE certification_rule_master ADD COLUMN ${column} ${definition}`);
    console.log(`[schema] certification_rule_master.${column} added`);
  }
  await ensureCriterionTable();
  await migrateLegacyGates();
}
