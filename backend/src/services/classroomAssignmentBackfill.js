import { prisma } from '../utils/db.js';

// Two distinct gaps land here, both because enrollment code (adminBulkAddTrainees,
// the enroll-existing/change-batch transfer path) only ever maps a trainee against
// batch.classroomId as it stood at that exact moment, and never loops over a
// batch's OTHER classrooms:
//   1. A batch created with no classroom picked, then bulk-imported, leaves every
//      trainee with classroom_id NULL and zero trainee_classroom_map rows.
//   2. A batch with MULTIPLE classrooms (batch_classroom_map) only ever propagates
//      its PRIMARY classroom to trainees -- any secondary classroom (and whatever
//      days/modules live only there) is never mapped to them at all, even though
//      the batch itself correctly shows that classroom as attached.
// Reported live for Batch 445 / ONF-SEP26-005 (Day 1-4 unreachable, "classrooms
// not assigned automatic to users") -- confirmed the classroom(s) genuinely were
// picked at batch-creation time, which points at gap #2 rather than #1 for that
// batch specifically, but both are real and this repairs both. This project
// deploys by pulling code rather than running migrations, so the repair runs here
// at boot instead of a one-off script somebody has to remember to run. Idempotent
// and additive only: a trainee's EXISTING classroom_id/map rows are never
// overwritten or deactivated, only missing ones are added.
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

  // Every classroom a batch has attached (primary included -- adminCreateBatch and
  // attachBatchClassrooms both insert a batch_classroom_map row for it) against
  // every currently-enrolled trainee in that batch. This is gap #2: a batch's
  // secondary classroom(s) were never looped over when trainees were bulk-added.
  const mapFromBatchClassrooms = await prisma.$executeRawUnsafe(`
    INSERT INTO trainee_classroom_map (id, employee_id, classroom_id, batch_no, assigned_date, active, remarks)
    SELECT UUID(), t.employee_id, bcm.classroom_id, t.batch_no, NOW(3), 1,
           'Backfilled: batch classroom had not been mapped to this trainee'
      FROM trainee_master t
      INNER JOIN batch_classroom_map bcm ON bcm.batch_no = t.batch_no AND bcm.active = 1
     WHERE t.status <> 'Deleted'
       AND NOT EXISTS (
         SELECT 1 FROM trainee_classroom_map m
          WHERE m.employee_id = t.employee_id AND m.classroom_id = bcm.classroom_id AND m.active = 1
       )
    ON DUPLICATE KEY UPDATE active = 1, batch_no = VALUES(batch_no)
  `);
  if (mapFromBatchClassrooms > 0) {
    console.log(`[schema] trainee_classroom_map: backfilled/reactivated ${mapFromBatchClassrooms} mapping(s) from batch_classroom_map (covers secondary classrooms too)`);
  }

  // Fallback for older/legacy batches that have classroom_id set but somehow no
  // batch_classroom_map row at all (gap #1, or a map row that failed to write).
  const mapFromPrimary = await prisma.$executeRawUnsafe(`
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
  if (mapFromPrimary > 0) {
    console.log(`[schema] trainee_classroom_map: backfilled/reactivated ${mapFromPrimary} mapping(s) for batches with a primary classroom but no batch_classroom_map row`);
  }
}
