import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function generateSalt() { return randomBytes(16).toString('hex'); }
async function hash(pass, salt) { return bcrypt.hash(pass + salt, 10); }

async function main() {
  console.log('Seeding LMS 2.0...');

  // Process / LOB master
  const processes = [
    { process: 'Demo Process', lob: 'All' },
    { process: 'Collections', lob: 'KYC' },
    { process: 'Collections', lob: 'Cards' },
    { process: 'Onboarding', lob: 'CASA' },
    { process: 'Customer Service', lob: 'Retail' },
  ];
  for (const p of processes) {
    await prisma.processLobMaster.upsert({ where: { process_lob: p }, create: p, update: {} });
  }

  // Demo coordinator
  await prisma.roleAccessMatrix.upsert({
    where: { loginId: 'COORD-TEST' },
    create: {
      loginId: 'COORD-TEST', pin: '1234', name: 'Demo Coordinator',
      role: 'Coordinator', portalAccess: 'Coordinator',
      branch: 'Noida – Okaya', process: 'Demo Process', lob: 'All', active: true,
      canCreateBatch: true, canOnboardTrainee: true, canCloseBatch: true,
    },
    update: {},
  });

  // Super admin coordinator
  await prisma.roleAccessMatrix.upsert({
    where: { loginId: 'ADMIN-COORD' },
    create: {
      loginId: 'ADMIN-COORD', pin: 'admin@123', name: 'Admin Coordinator',
      role: 'Super Admin', portalAccess: 'Coordinator',
      branch: 'HQ', process: 'All', lob: 'All', active: true,
      canCreateBatch: true, canOnboardTrainee: true, canUploadLmsReport: true,
      canOverrideAttendance: true, canCloseBatch: true, canViewManagementDashboard: true,
    },
    update: {},
  });

  // Management user
  await prisma.roleAccessMatrix.upsert({
    where: { loginId: 'CEO-001' },
    create: {
      loginId: 'CEO-001', pin: 'ceo123', name: 'CEO', role: 'CEO',
      portalAccess: 'Management', branch: 'All', process: 'All', lob: 'All', active: true,
      canViewManagementDashboard: true,
    },
    update: {},
  });

  // Admin user
  const adminSalt = generateSalt();
  const adminHash = await hash('admin1234', adminSalt);
  await prisma.adminUserMaster.upsert({
    where: { adminId: 'LMS-ADMIN' },
    create: { adminId: 'LMS-ADMIN', passwordHash: adminHash, salt: adminSalt, adminName: 'LMS Admin', role: 'Admin' },
    update: { passwordHash: adminHash, salt: adminSalt, locked: false, failedAttempts: 0 },
  });

  // Demo classroom
  await prisma.classroomMaster.upsert({
    where: { classroomId: 'CL-DEMO-001' },
    create: {
      classroomId: 'CL-DEMO-001',
      classroomName: 'Demo Process Training Classroom',
      process: 'Demo Process',
      lob: 'All',
      description: 'Demo classroom for testing LMS 2.0',
    },
    update: {},
  });

  // Day 1 – Module 1
  await prisma.moduleMaster.upsert({
    where: { moduleId: 'MOD-DEMO-01' },
    create: {
      moduleId: 'MOD-DEMO-01',
      classroomId: 'CL-DEMO-001',
      dayNo: 1,
      moduleTitle: 'Introduction to Process',
      moduleOrder: 1,
    },
    update: {},
  });

  // Content
  await prisma.contentMaster.upsert({
    where: { contentId: 'CON-DEMO-01' },
    create: {
      contentId: 'CON-DEMO-01',
      moduleId: 'MOD-DEMO-01',
      contentType: 'video',
      contentTitle: 'Welcome to the Training Program',
      driveUrl: 'https://drive.google.com/file/d/DEMO_FILE_ID/preview',
      playerMode: 'Drive Preview',
      contentOrder: 1,
      estimatedMins: 10,
      completionRulePct: 80,
      description: 'Overview of the training program structure.',
    },
    update: {},
  });

  // FAQ
  await prisma.faqMaster.upsert({
    where: { faqId: 'FAQ-DEMO-01' },
    create: {
      faqId: 'FAQ-DEMO-01',
      moduleId: 'MOD-DEMO-01',
      question: 'What is the duration of this training?',
      answer: 'The training runs for 5 days covering all modules.',
      sortOrder: 1,
    },
    update: {},
  });

  // Demo assessment
  await prisma.assessmentMaster.upsert({
    where: { assessmentId: 'ASS-DEMO-01' },
    create: {
      assessmentId: 'ASS-DEMO-01',
      classroomId: 'CL-DEMO-001',
      dayNo: 1,
      moduleId: 'MOD-DEMO-01',
      assessmentName: 'Day 1 Assessment',
      passingPct: 60,
      attemptLimit: 3,
      timeLimitMins: 30,
      instructions: 'Answer all questions. Each correct answer carries 1 mark.',
    },
    update: {},
  });

  // Demo questions
  const questions = [
    { questionId: 'QST-D1-1', questionText: 'What is the primary goal of customer service?', optionA: 'Profit maximization', optionB: 'Customer satisfaction', optionC: 'Cost reduction', optionD: 'Employee retention', correctOption: 'B' },
    { questionId: 'QST-D1-2', questionText: 'What does KYC stand for?', optionA: 'Know Your Customer', optionB: 'Keep Your Cash', optionC: 'Know Your Compliance', optionD: 'Key Year Calculation', correctOption: 'A' },
    { questionId: 'QST-D1-3', questionText: 'Active listening means:', optionA: 'Listening while multitasking', optionB: 'Fully focusing on the speaker', optionC: 'Waiting for your turn to speak', optionD: 'Nodding without understanding', correctOption: 'B' },
  ];
  for (const q of questions) {
    await prisma.questionBank.upsert({
      where: { questionId: q.questionId },
      create: { ...q, assessmentId: 'ASS-DEMO-01', marks: 1 },
      update: {},
    });
  }

  // Demo batch
  await prisma.batchMaster.upsert({
    where: { batchNo: 'DEM_ALL_MAY\'26_001' },
    create: {
      batchNo: "DEM_ALL_MAY'26_001",
      batchName: 'Demo Process Training Batch',
      batchType: 'NHT',
      branch: 'Noida – Okaya',
      process: 'Demo Process',
      lob: 'All',
      classroomId: 'CL-DEMO-001',
      classroomName: 'Demo Process Training Classroom',
      coordinatorName: 'Demo Coordinator',
      coordinatorLoginId: 'COORD-TEST',
      batchStatus: 'Active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      expectedTrainees: 3,
      totalTrainees: 1,
      createdBy: 'COORD-TEST',
    },
    update: {},
  });

  // Demo trainee — TraineeMaster must be created before UserMaster (FK)
  const traineeSalt = generateSalt();

  await prisma.traineeMaster.upsert({
    where: { employeeId: 'EMP1001' },
    create: {
      employeeId: 'EMP1001',
      lmsId: 'LMS001001',
      traineeName: 'Demo Trainee',
      mobile: '9999901001',
      batchNo: "DEM_ALL_MAY'26_001",
      branch: 'Noida – Okaya',
      process: 'Demo Process',
      lob: 'All',
      classroomId: 'CL-DEMO-001',
      classroomName: 'Demo Process Training Classroom',
      onboardingDate: new Date(),
      createdBy: 'COORD-TEST',
    },
    update: {},
  });

  await prisma.userMaster.upsert({
    where: { employeeId: 'EMP1001' },
    create: {
      employeeId: 'EMP1001',
      passwordHash: await hash('1234', traineeSalt),
      salt: traineeSalt,
      traineeName: 'Demo Trainee',
      mobile: '9999901001',
      branch: 'Noida – Okaya',
      process: 'Demo Process',
      lob: 'All',
      batchNo: "DEM_ALL_MAY'26_001",
      classroomId: 'CL-DEMO-001',
      forcePasswordReset: true,
    },
    update: {},
  });

  await prisma.traineeClassroomMap.upsert({
    where: { employeeId_classroomId: { employeeId: 'EMP1001', classroomId: 'CL-DEMO-001' } },
    create: { employeeId: 'EMP1001', classroomId: 'CL-DEMO-001', batchNo: "DEM_ALL_MAY'26_001", assignedBy: 'COORD-TEST' },
    update: {},
  });

  // Certification rule
  await prisma.certificationRuleMaster.upsert({
    where: { process_lob: { process: 'Demo Process', lob: 'All' } },
    create: {
      ruleId: 'RULE-DEMO-001',
      process: 'Demo Process',
      lob: 'All',
      courseCompletionMin: 80,
      mcqPassPctMin: 60,
      attendancePctMin: 70,
      mockCallRequired: false,
    },
    update: {},
  });

  console.log('Seed complete!');
  console.log('\nDemo credentials:');
  console.log('  Coordinator: COORD-TEST / 1234  (URL: /coordinator)');
  console.log('  Admin:       LMS-ADMIN / admin1234  (URL: /admin)');
  console.log('  Trainee:     EMP1001 / 1234  (URL: /lms)');
  console.log('  Management:  CEO-001 / ceo123  (URL: /management)');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
