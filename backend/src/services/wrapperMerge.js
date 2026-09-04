import { prisma } from '../utils/db.js';

// Broadcasting repository content used to mint an IND-CONTENT-<id> wrapper module
// even when an admin had already built a real module around that same content. The
// wrapper carries no reading time, category or process, so the module the admin
// configured was never the one trainees received.
//
// resolveBroadcastTarget now prefers the owning module, and this moves the
// assignments that were already created onto it. Idempotent: once a wrapper has no
// active assignments left there is nothing to move.
export async function mergeContentWrappersIntoOwningModules({ dryRun = false } = {}) {
  const pairs = await prisma.$queryRawUnsafe(`
    SELECT w.module_id AS wrapper_id,
           m.module_id  AS owner_id,
           m.module_name AS owner_name,
           wc.repository_content_id AS content_id
      FROM independent_module_master w
      INNER JOIN independent_module_content_map wc
              ON wc.module_id = w.module_id AND wc.active = 1
      INNER JOIN independent_module_content_map oc
              ON oc.repository_content_id = wc.repository_content_id AND oc.active = 1
      INNER JOIN independent_module_master m
              ON m.module_id = oc.module_id
             AND m.status = 'Active'
             AND m.module_id NOT LIKE 'IND-CONTENT-%'
     WHERE w.module_id LIKE 'IND-CONTENT-%'
       AND w.status = 'Active'
     GROUP BY w.module_id, m.module_id, m.module_name, wc.repository_content_id
  `);

  const moved = [];
  for (const pair of pairs || []) {
    const assignments = await prisma.assignedModule.findMany({
      where: { moduleId: pair.wrapper_id, active: true },
      select: { id: true, assignedTo: true, assignedToType: true },
    });
    if (!assignments.length) continue;

    let repointed = 0;
    let deduped = 0;
    for (const assignment of assignments) {
      // The owner may already be assigned to this person; keep one row, retire the other.
      const existing = await prisma.assignedModule.findFirst({
        where: {
          moduleId: pair.owner_id,
          assignedTo: assignment.assignedTo,
          assignedToType: assignment.assignedToType,
          active: true,
        },
        select: { id: true },
      });
      if (dryRun) { existing ? deduped += 1 : repointed += 1; continue; }
      if (existing) {
        await prisma.assignedModule.update({ where: { id: assignment.id }, data: { active: false } });
        deduped += 1;
      } else {
        await prisma.assignedModule.update({
          where: { id: assignment.id },
          data: { moduleId: pair.owner_id, moduleName: pair.owner_name },
        });
        repointed += 1;
      }
    }

    if (!dryRun) {
      // The wrapper has served its purpose; retiring it keeps it out of the admin list.
      await prisma.$executeRawUnsafe(
        "UPDATE independent_module_master SET status = 'Archived' WHERE module_id = ?",
        pair.wrapper_id,
      );
    }
    moved.push({ wrapper: pair.wrapper_id, owner: pair.owner_id, repointed, deduped });
  }
  return moved;
}
