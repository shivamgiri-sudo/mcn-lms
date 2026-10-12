import { prisma } from '../utils/db.js';

// My Process Certification Journey.
//
// Certification here is derived ONLY from assigned classrooms: a classroom is Certified
// when every required module content is complete and every active assessment attached
// to it has been passed; a process is Certified when all of its classrooms are. It is
// computed from the live content_progress / assessment_results rows on every request,
// so it follows completion and assessment changes with no sync step. It deliberately
// ignores attendance, onboarding, typing, OJT and coordinator-recorded evidence, and it
// does not write to trainee_master.certification_status.

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

const contentDone = (p) => Boolean(p) && (p.completionStatus === 'Completed' || Number(p.completionPct || 0) >= 100);

function assessmentSummary(assessments, resultByAssessment) {
  if (!assessments.length) return { result: 'Not Required', passed: 0, total: 0, allPassed: true };
  const results = assessments.map(a => resultByAssessment.get(a.assessmentId));
  const passed = results.filter(r => r?.result === 'Pass').length;
  const failed = results.some(r => r && r.result !== 'Pass');
  // A failed attempt is shown as Fail until it is passed; otherwise anything not yet
  // attempted keeps the classroom Pending.
  const result = passed === assessments.length ? 'Pass' : failed ? 'Fail' : 'Pending';
  return { result, passed, total: assessments.length, allPassed: passed === assessments.length };
}

export async function getLearningJourney(req, res) {
  try {
    const employeeId = req.userId;
    const trainee = await prisma.traineeMaster.findUnique({
      where: { employeeId },
      select: { employeeId: true, classroomId: true, process: true, batchNo: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Certification journey was not found.' });

    const maps = await prisma.traineeClassroomMap.findMany({ where: { employeeId, active: true }, select: { classroomId: true } });
    const classroomIds = [...new Set([...maps.map(m => m.classroomId), trainee.classroomId].filter(Boolean))];

    const classrooms = classroomIds.length
      ? await prisma.classroomMaster.findMany({ where: { classroomId: { in: classroomIds } }, select: { classroomId: true, classroomName: true, process: true } })
      : [];
    const [modules, assessments, results] = classroomIds.length
      ? await Promise.all([
        prisma.moduleMaster.findMany({
          where: { classroomId: { in: classroomIds }, active: true, required: true },
          select: { moduleId: true, classroomId: true, contents: { where: { active: true, required: true }, select: { contentId: true } } },
        }),
        prisma.assessmentMaster.findMany({ where: { classroomId: { in: classroomIds }, active: true }, select: { assessmentId: true, classroomId: true } }),
        prisma.assessmentResult.findMany({ where: { employeeId, classroomId: { in: classroomIds } }, select: { assessmentId: true, result: true } }),
      ])
      : [[], [], []];

    const contentIds = modules.flatMap(m => m.contents.map(c => c.contentId));
    const progress = contentIds.length
      ? await prisma.contentProgress.findMany({ where: { employeeId, contentId: { in: contentIds } }, select: { contentId: true, completionStatus: true, completionPct: true } })
      : [];
    const progressByContent = new Map(progress.map(p => [p.contentId, p]));
    const resultByAssessment = new Map(results.map(r => [r.assessmentId, r]));

    const rows = classrooms.map(room => {
      const ids = modules.filter(m => m.classroomId === room.classroomId).flatMap(m => m.contents.map(c => c.contentId));
      const done = ids.filter(id => contentDone(progressByContent.get(id))).length;
      const completionPct = pct(done, ids.length);
      const assess = assessmentSummary(assessments.filter(a => a.classroomId === room.classroomId), resultByAssessment);
      // No required content means nothing to complete - never certify an empty classroom.
      const certified = ids.length > 0 && done === ids.length && assess.allPassed;
      const started = done > 0 || assess.passed > 0 || assess.result === 'Fail';
      return {
        classroomId: room.classroomId,
        classroomName: room.classroomName,
        process: room.process || trainee.process || 'Unassigned',
        completionPct,
        contentsCompleted: done,
        contentsTotal: ids.length,
        assessmentResult: assess.result,
        assessmentsPassed: assess.passed,
        assessmentsTotal: assess.total,
        certificationStatus: certified ? 'Certified' : started ? 'In Progress' : 'Not Certified',
      };
    }).sort((a, b) => a.process.localeCompare(b.process) || a.classroomName.localeCompare(b.classroomName));

    const processes = [...new Set(rows.map(r => r.process))].map(name => {
      const inProcess = rows.filter(r => r.process === name);
      const certifiedCount = inProcess.filter(r => r.certificationStatus === 'Certified').length;
      const certified = certifiedCount === inProcess.length;
      return {
        process: name,
        classroomsTotal: inProcess.length,
        classroomsCertified: certifiedCount,
        progressPct: pct(certifiedCount, inProcess.length),
        certificationStatus: certified ? 'Certified' : inProcess.some(r => r.certificationStatus !== 'Not Certified') ? 'In Progress' : 'Not Certified',
      };
    });

    const certifiedClassrooms = rows.filter(r => r.certificationStatus === 'Certified').length;
    return res.json({
      ok: true,
      data: {
        employeeId,
        classrooms: rows,
        processes,
        classroomsTotal: rows.length,
        classroomsCertified: certifiedClassrooms,
        overallProgressPct: pct(certifiedClassrooms, rows.length),
        overallCertified: rows.length > 0 && certifiedClassrooms === rows.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[traineeJourney] certification journey load failed:', error);
    return res.status(500).json({ ok: false, message: 'Certification journey could not be loaded.' });
  }
}
