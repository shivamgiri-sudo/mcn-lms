import { prisma } from '../utils/db.js';
import { getClassroomCertification } from '../services/classroomCertification.js';

// My Process Certification Journey: certification progress from assigned classrooms
// only (see services/classroomCertification.js). Read-only; it does not write to
// trainee_master.certification_status.
export async function getLearningJourney(req, res) {
  try {
    const employeeId = req.userId;
    const trainee = await prisma.traineeMaster.findUnique({ where: { employeeId }, select: { employeeId: true } });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Certification journey was not found.' });
    const data = await getClassroomCertification(employeeId);
    return res.json({ ok: true, data: { employeeId, ...data, generatedAt: new Date().toISOString() } });
  } catch (error) {
    console.error('[traineeJourney] certification journey load failed:', error);
    return res.status(500).json({ ok: false, message: 'Certification journey could not be loaded.' });
  }
}
