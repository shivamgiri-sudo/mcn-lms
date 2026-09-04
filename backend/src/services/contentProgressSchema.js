import { prisma } from '../utils/db.js';

// content_progress predates the acknowledgement columns, and this project deploys
// by pulling code rather than running migrations, so they are added in place at
// boot. Safe to run repeatedly.
const ACK_COLUMNS = [
  ['acknowledged_at', 'DATETIME(3) NULL AFTER player_mode'],
  ['acknowledged_ip', 'VARCHAR(64) NULL AFTER acknowledged_at'],
  ['acknowledged_user_agent', 'TEXT NULL'],
  ['acknowledgement_text', 'TEXT NULL'],
];

async function hasColumn(table, column) {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*) AS present FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    table, column,
  );
  return Number(row?.present ?? row?.PRESENT ?? 0) > 0;
}

export async function ensureContentProgressAcknowledgementColumns() {
  for (const [column, definition] of ACK_COLUMNS) {
    if (await hasColumn('content_progress', column)) continue;
    await prisma.$executeRawUnsafe(`ALTER TABLE content_progress ADD COLUMN ${column} ${definition}`);
    console.log(`[schema] content_progress.${column} added`);
  }

  // Acknowledgement did not exist before this feature, so every real completion
  // that predates it is grandfathered rather than retroactively locking sequential
  // unlock and assessment submission for people who genuinely finished the content.
  // Idempotent: only rows with no acknowledgement are touched, so this is a no-op
  // on every boot after the first.
  const result = await prisma.$executeRawUnsafe(`
    UPDATE content_progress
       SET acknowledged_at = COALESCE(completed_at, updated_at),
           acknowledgement_text = 'Backfilled: completed before the acknowledgement requirement existed.'
     WHERE acknowledged_at IS NULL
       AND (completion_status = 'Completed' OR completion_pct >= 100)
  `);
  if (result > 0) console.log(`[schema] content_progress: backfilled acknowledgement for ${result} pre-existing completion(s)`);
}
