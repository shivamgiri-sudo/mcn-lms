import { prisma } from '../utils/db.js';

// certification_rule_master predates the Process Quality columns, and this project
// deploys by pulling code rather than running migrations, so the columns are added
// in place at boot. Safe to run repeatedly.
const PQ_COLUMNS = [
  ['pq_required', "TINYINT(1) NOT NULL DEFAULT 0 AFTER external_cert_pass_pct"],
  ['pq_target_pct', "DOUBLE NOT NULL DEFAULT 85 AFTER pq_required"],
  ['pq_days', "INT NOT NULL DEFAULT 5 AFTER pq_target_pct"],
];

async function hasColumn(table, column) {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    table, column,
  );
  return Number(row?.present ?? row?.PRESENT ?? 0) > 0;
}

export async function ensureCertificationRuleColumns() {
  for (const [column, definition] of PQ_COLUMNS) {
    if (await hasColumn('certification_rule_master', column)) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE certification_rule_master ADD COLUMN ${column} ${definition}`);
    console.log(`[schema] certification_rule_master.${column} added`);
  }
}
