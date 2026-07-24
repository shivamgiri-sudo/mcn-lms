import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function generateSalt() { return randomBytes(16).toString('hex'); }
async function hashPassword(value, salt) { return bcrypt.hash(value + salt, 12); }
async function hashCredential(value) {
  const salt = generateSalt();
  const hash = await hashPassword(value, salt);
  return `v1$bcrypt$${salt}$${hash}`;
}

function requiredSecret(name, minLength = 8) {
  const value = String(process.env[name] || '');
  if (value.length < minLength) {
    throw new Error(`${name} must be configured with at least ${minLength} characters before demo seeding.`);
  }
  return value;
}

async function seedReferenceMasters() {
  const configured = String(process.env.LMS_SEED_PROCESS_LOB_JSON || '').trim();
  if (!configured) return;

  let processes;
  try {
    processes = JSON.parse(configured);
  } catch {
    throw new Error('LMS_SEED_PROCESS_LOB_JSON must be a valid JSON array.');
  }

  if (!Array.isArray(processes)) throw new Error('LMS_SEED_PROCESS_LOB_JSON must be an array.');
  for (const item of processes) {
    const process = String(item?.process || '').trim();
    const lob = String(item?.lob || '').trim();
    if (!process || !lob) continue;
    await prisma.processLobMaster.upsert({
      where: { process_lob: { process, lob } },
      create: { process, lob },
      update: { active: true },
    });
  }
}

async function seedDemoEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Demo seeding is blocked when NODE_ENV=production.');
  }

  const coordinatorPin = requiredSecret('LMS_SEED_COORDINATOR_PIN');
  const managementPin = requiredSecret('LMS_SEED_MANAGEMENT_PIN');
  const adminPassword = requiredSecret('LMS_SEED_ADMIN_PASSWORD', 12);
  const traineePassword = requiredSecret('LMS_SEED_TRAINEE_PASSWORD');

  await prisma.processLobMaster.upsert({
    where: { process_lob: { process: 'Demo Process', lob: 'All' } },
    create: { process: 'Demo Process', lob: 'All' },
    update: {},
  });

  await prisma.roleAccessMatrix.upsert({
    where: { loginId: 'COORD-TEST' },
    create: {
      loginId: 'COORD-TEST', pin: await hashCredential(coordinatorPin), name: 'Demo Coordinator',
      role: 'Coordinator', portalAccess: 'Coordinator', branch: 'Demo Branch', process: 'Demo Process', lob: 'All', active: true,
      canCreateBatch: true, canOnboardTrainee: true, canCloseBatch: true,
    },
    update: {},
  });

  await prisma.roleAccessMatrix.upsert({
    where: { loginId: 'CEO-001' },
    create: {
      loginId: 'CEO-001', pin: await hashCredential(managementPin), name: 'Demo Management User', role: 'CEO',
      portalAccess: 'Management', branch: 'All', process: 'All', lob: 'All', active: true,
      canViewManagementDashboard: true,
    },
    update: {},
  });

  const adminSalt = generateSalt();
  const adminHash = await hashPassword(adminPassword, adminSalt);
  await prisma.adminUserMaster.upsert({
    where: { adminId: 'LMS-ADMIN' },
    create: { adminId: 'LMS-ADMIN', passwordHash: adminHash, salt: adminSalt, adminName: 'LMS Admin', role: 'Super Admin' },
    // Never rotate an existing administrator credential during a seed run.
    update: {},
  });

  await prisma.classroomMaster.upsert({
    where: { classroomId: 'CL-DEMO-001' },
    create: {
      classroomId: 'CL-DEMO-001', classroomName: 'Demo Process Training Classroom', process: 'Demo Process', lob: 'All',
      description: 'Development-only classroom for LMS validation.',
    },
    update: {},
  });

  await prisma.moduleMaster.upsert({
    where: { moduleId: 'MOD-DEMO-01' },
    create: { moduleId: 'MOD-DEMO-01', classroomId: 'CL-DEMO-001', dayNo: 1, moduleTitle: 'Introduction to Process', moduleOrder: 1 },
    update: {},
  });

  await prisma.contentMaster.upsert({
    where: { contentId: 'CON-DEMO-01' },
    create: {
      contentId: 'CON-DEMO-01', moduleId: 'MOD-DEMO-01', contentType: 'video', contentTitle: 'Welcome to the Training Program',
      playerMode: 'Direct', contentOrder: 1, estimatedMins: 10, completionRulePct: 80,
      description: 'Overview of the training program structure.',
    },
    update: {},
  });

  await prisma.faqMaster.upsert({
    where: { faqId: 'FAQ-DEMO-01' },
    create: {
      faqId: 'FAQ-DEMO-01', moduleId: 'MOD-DEMO-01', question: 'What is the duration of this training?',
      answer: 'The demo training runs for one day.', sortOrder: 1,
    },
    update: {},
  });

  await prisma.assessmentMaster.upsert({
    where: { assessmentId: 'ASS-DEMO-01' },
    create: {
      assessmentId: 'ASS-DEMO-01', classroomId: 'CL-DEMO-001', dayNo: 1, moduleId: 'MOD-DEMO-01',
      assessmentName: 'Day 1 Assessment', passingPct: 60, attemptLimit: 3, timeLimitMins: 30,
      instructions: 'Answer all questions. Each correct answer carries one mark.',
    },
    update: {},
  });

  const questions = [
    { questionId: 'QST-D1-1', questionText: 'What is the primary goal of customer service?', optionA: 'Profit maximization', optionB: 'Customer satisfaction', optionC: 'Cost reduction', optionD: 'Employee retention', correctOption: 'B' },
    { questionId: 'QST-D1-2', questionText: 'What does KYC stand for?', optionA: 'Know Your Customer', optionB: 'Keep Your Cash', optionC: 'Know Your Compliance', optionD: 'Key Year Calculation', correctOption: 'A' },
    { questionId: 'QST-D1-3', questionText: 'Active listening means:', optionA: 'Listening while multitasking', optionB: 'Fully focusing on the speaker', optionC: 'Waiting for your turn to speak', optionD: 'Nodding without understanding', correctOption: 'B' },
  ];
  for (const question of questions) {
    await prisma.questionBank.upsert({
      where: { questionId: question.questionId },
      create: { ...question, assessmentId: 'ASS-DEMO-01', marks: 1 },
      update: {},
    });
  }

  const batchNo = 'DEMO-BATCH-001';
  await prisma.batchMaster.upsert({
    where: { batchNo },
    create: {
      batchNo, batchName: 'Demo Process Training Batch', batchType: 'NHT', branch: 'Demo Branch', process: 'Demo Process', lob: 'All',
      classroomId: 'CL-DEMO-001', classroomName: 'Demo Process Training Classroom', coordinatorName: 'Demo Coordinator',
      coordinatorLoginId: 'COORD-TEST', batchStatus: 'Active', startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000), expectedTrainees: 1, totalTrainees: 1, createdBy: 'COORD-TEST',
    },
    update: {},
  });

  const employeeId = 'EMP1001';
  await prisma.traineeMaster.upsert({
    where: { employeeId },
    create: {
      employeeId, lmsId: 'LMS001001', traineeName: 'Demo Trainee', batchNo, branch: 'Demo Branch', process: 'Demo Process', lob: 'All',
      classroomId: 'CL-DEMO-001', classroomName: 'Demo Process Training Classroom', onboardingDate: new Date(), createdBy: 'COORD-TEST',
    },
    update: {},
  });

  const traineeSalt = generateSalt();
  await prisma.userMaster.upsert({
    where: { employeeId },
    create: {
      employeeId, passwordHash: await hashPassword(traineePassword, traineeSalt), salt: traineeSalt, traineeName: 'Demo Trainee',
      branch: 'Demo Branch', process: 'Demo Process', lob: 'All', batchNo, classroomId: 'CL-DEMO-001', forcePasswordReset: true,
    },
    update: {},
  });

  await prisma.traineeClassroomMap.upsert({
    where: { employeeId_classroomId: { employeeId, classroomId: 'CL-DEMO-001' } },
    create: { employeeId, classroomId: 'CL-DEMO-001', batchNo, assignedBy: 'COORD-TEST' },
    update: {},
  });

  await prisma.certificationRuleMaster.upsert({
    where: { process_lob: { process: 'Demo Process', lob: 'All' } },
    create: {
      ruleId: 'RULE-DEMO-001', process: 'Demo Process', lob: 'All', courseCompletionMin: 80,
      mcqPassPctMin: 60, attendancePctMin: 70, mockCallRequired: false,
    },
    update: {},
  });

  console.log('Development demo data seeded. Credentials were read from protected environment variables and were not printed.');
}

async function main() {
  console.log('Starting safe LMS seed...');
  await seedReferenceMasters();

  if (process.env.LMS_ALLOW_DEMO_SEED === 'true') {
    await seedDemoEnvironment();
  } else {
    console.log('Demo data skipped. Set LMS_ALLOW_DEMO_SEED=true in a non-production environment to enable it.');
  }
}

main()
  .catch(error => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
