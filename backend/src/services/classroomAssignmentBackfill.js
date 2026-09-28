import { prisma } from '../utils/db.js';

// A batch's classroom can be attached (adminUpdateBatch's syncBatchClassroomAssignment)
// AFTER trainees were already bulk-added to it -- adminBulkAddTrainees, and the
// enroll-existing / change-batch transfer path, only ever write batch.classroomId
// as it stood AT THAT MOMENT, so a batch created via the wizard's default
// "No classroom yet" option and then bulk-imported leaves every trainee with
// classroom_id NULL and zero trainee_classroom_map rows -- invisible/unreachable
// curriculum content for the whole batch (reported live for Batch 445 / ONF-SEP26-005:
// Day 1-4 unreachable, "classrooms not assigned automatic to users"). This project
// deploys by pulling code rather than running migrations, so the repair runs here at
// boot instead of a one-off script somebody has to remember to run. Idempotent: only
// trainees with a NULL classroom_id (or missing the active map row) are touched, so a
// deliberately multi-classroom trainee whose classroom_id is already set to something
// else is never overwritten -- this backfills the "nobody ever assigned one" gap, not a
// disagreement about which classroom is correct.
export async function backfillMissingBatchClassroomAssignments() {
  const traineeResult = await prisma.$executeRawUnsafe(`
    UPDATE trainee_master t
    INNER JOIN batch_master b ON b.batch_no = t.batch_no
       SET t.classroom_id = b.classroom_id, t.classroom_name = b.classroom_name
     WHERE b.classroom_id IS NOT NULL
       AND t.classroom_id IS NULL
       AND t.status <> 'Deleted'
  `);
  if (traineeResult > 0) {
    console.log(`[schema] trainee_master: backfilled classroom_id for ${traineeResult} trainee(s) whose batch had a classroom they were never assigned to`);
  }

  const userResult = await prisma.$executeRawUnsafe(`
    UPDATE user_master u
    INNER JOIN trainee_master t ON t.employee_id = u.employee_id
    INNER JOIN batch_master b ON b.batch_no = t.batch_no
       SET u.classroom_id = b.classroom_id
     WHERE b.classroom_id IS NOT NULL
       AND u.classroom_id IS NULL
       AND t.status <> 'Deleted'
  `);
  if (userResult > 0) {
    console.log(`[schema] user_master: backfilled classroom_id for ${userResult} account(s) whose batch had a classroom they were never assigned to`);
  }

  const mapResult = await prisma.$executeRawUnsafe(`
    INSERT INTO trainee_classroom_map (id, employee_id, classroom_id, batch_no, assigned_date, active, remarks)
    SELECT UUID(), t.employee_id, b.classroom_id, t.batch_no, NOW(3), 1,
           'Backfilled: batch classroom had not been mapped to this trainee'
      FROM trainee_master t
      INNER JOIN batch_master b ON b.batch_no = t.batch_no
     WHERE b.classroom_id IS NOT NULL
       AND t.status <> 'Deleted'
       AND NOT EXISTS (
         SELECT 1 FROM trainee_classroom_map m
          WHERE m.employee_id = t.employee_id AND m.classroom_id = b.classroom_id AND m.active = 1
       )
    ON DUPLICATE KEY UPDATE active = 1, batch_no = VALUES(batch_no)
  `);
  if (mapResult > 0) {
    console.log(`[schema] trainee_classroom_map: backfilled/reactivated ${mapResult} mapping(s) for trainees whose batch classroom was missing an active map row`);
  }
}
