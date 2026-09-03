import { prisma } from '../utils/db.js';

// certification_rule_master predates the Process Quality columns, and this project
// deploys by pulling code rather than running migrations, so the columns are added
// in place at boot. Safe to run repeatedly.
const PQ_COLUMNS = [
  ['pq_required', "TINYINT(1) NOT NULL DEFAULT 0 AFTER external_cert_pass_pct"],
  ['pq_max_error_pct', "DOUBLE NOT NULL DEFAULT 2.5 AFTER pq_required"],
  ['pq_days', "INT NOT NULL DEFAULT 5 AFTER pq_max_error_pct"],
];

async function hasColumn(table, column) {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    table, column,
  );
  return Number(row?.present ?? row?.PRESENT ?? 0) > 0;
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
}
