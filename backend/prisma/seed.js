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

async function seedTypingPrompts() {
  const prompts = [
    // ── EASY (8) ──────────────────────────────────────────────────────────────
    {
      title: 'Basic Name and DOB',
      body: 'SMITH, John Edward — Date of Birth: 15 January 1989 — Nationality: British',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['name', 'dob']),
    },
    {
      title: 'Simple UK Address',
      body: '42 Kensington Road, London, SW1A 2AA, United Kingdom',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Document Type Label',
      body: 'Document Type: PASSPORT — Issuing Country: UNITED KINGDOM — Status: VALID',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['document-type']),
    },
    {
      title: 'Nationality Field',
      body: 'Surname: PATEL — Given Names: PRIYA MEERA — Nationality: INDIAN — Sex: F',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['name', 'nationality']),
    },
    {
      title: 'Basic Timed Drill 1min',
      body: 'Type names and dates as they appear. JOHNSON, Mark David. Born 03 March 1992. Nationality: British.',
      mode: 'TIMED_DRILL', durationSeconds: 60, difficulty: 'EASY', tags: JSON.stringify(['name', 'dob']),
    },
    {
      title: 'Address Timed Drill 1min',
      body: 'Flat 2, 88 Baker Street, London NW1 6XE. Occupation: Customer Service Agent. Date: 12 April 2024.',
      mode: 'TIMED_DRILL', durationSeconds: 60, difficulty: 'EASY', tags: JSON.stringify(['address']),
    },
    {
      title: 'Simple Address 2',
      body: '17 Queen Victoria Street, Birmingham, B1 1BD — United Kingdom',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Personal Details Block',
      body: 'First Name: AISHA — Last Name: KHAN — Gender: Female — Date of Birth: 22/07/1995 — Nationality: Pakistani',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['name', 'dob', 'nationality']),
    },
    // ── MEDIUM (10) ───────────────────────────────────────────────────────────
    {
      title: 'Document Number with Prefix',
      body: 'Passport Number: GBR1234567 — Issue Date: 09 DEC 2019 — Expiry Date: 09 DEC 2029',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['document-number', 'expiry']),
    },
    {
      title: 'Alphanumeric Postcode Address',
      body: 'Flat 3B, 17 Albemarle Street, London W1S 4HE — Previous: 9 Elgin Crescent, London W11 2JA',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Combined Identity Block',
      body: 'Name: BROWN, Sarah Louise — DOB: 31 MAR 1987 — Nationality: GBR — Doc No: P-UK-98765432 — Expiry: 31 MAR 2032',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['name', 'dob', 'document-number', 'expiry']),
    },
    {
      title: 'EU Identity Card',
      body: 'Cognome: ROSSI — Nome: MARCO LUIGI — Nazionalità: ITA — N. Documento: CA1234567B — Scadenza: 15/08/2028',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['document-number', 'name', 'expiry']),
    },
    {
      title: 'Medium Timed Drill 3min',
      body: 'Reference: GBR9876543 — Address: 44 Gloucester Place, London W1U 8EA — DOB: 07 FEB 1990 — Expiry: 07 FEB 2030 — Nationality: British',
      mode: 'TIMED_DRILL', durationSeconds: 180, difficulty: 'MEDIUM', tags: JSON.stringify(['document-number', 'address', 'expiry']),
    },
    {
      title: 'Address with County',
      body: '3 Highfield Lane, Sutton Coldfield, West Midlands, B73 5RA — Tel: 0121-355-9876 — Ref: UK/2024/00342',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Date Format Mix',
      body: 'Date of Issue: 01 JAN 2020 — Date of Expiry: 31 DEC 2030 — Date of Birth: 14-06-1988 — Verification Date: 2024/03/22',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['expiry', 'dob']),
    },
    {
      title: 'Multi-Doc Reference Block',
      body: 'Driving Licence: SMITH901155JA9IY — NI Number: NJ 45 67 89 C — Passport: 098765432 — UTR: 1234567890',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['document-number']),
    },
    {
      title: 'Employer and Address Verification',
      body: 'Employer: MCN Callnet Solutions Pvt Ltd — Reg No: 12345678 — Address: Sector 63, Noida, UP 201307 — GSTIN: 09ABCDE1234F1Z5',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['address', 'document-number']),
    },
    {
      title: 'Medium Timed Drill 5min',
      body: 'NGUYEN, Van Thanh — DOB: 03/09/1993 — Passport: VNM4512876 — Address: 18 Thanh Xuan Street, Hanoi 10000, Vietnam — Expiry: 03/09/2033 — Nationality: Vietnamese',
      mode: 'TIMED_DRILL', durationSeconds: 300, difficulty: 'MEDIUM', tags: JSON.stringify(['name', 'dob', 'document-number', 'address']),
    },
    // ── HARD (7) ──────────────────────────────────────────────────────────────
    {
      title: 'MRZ Line Pair — UK Passport',
      body: 'P<GBRSMITH<<JOHN<EDWARD<<<<<<<<<<<<<<<<<<<<\n9674523761GBR8901157M3012317<<<<<<<<<6',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport']),
    },
    {
      title: 'MRZ Line Pair — German Passport',
      body: 'P<DEUMUELLER<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nC3B154778DEU8504216F2902128<<<<<<<<<4',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport']),
    },
    {
      title: 'MRZ Line Pair — Indian Passport',
      body: 'P<INDPATEL<<PRIYA<MEERA<<<<<<<<<<<<<<<<<<<<\nZ1234567BIND9507223F2907221<<<<<<<<<2',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport']),
    },
    {
      title: 'Full Identity Doc with MRZ',
      body: 'Surname: CHEN — Given: WEI MING — DOB: 12 AUG 1991 — Passport: E12345678 — Country: CHN — Expiry: 12 AUG 2031\nP<CHNECHEN<<WEI<MING<<<<<<<<<<<<<<<<<<<<<<\nE12345678CHN9108125M3108126<<<<<<<<<8',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport', 'name', 'dob']),
    },
    {
      title: 'Hard Timed Drill 3min — Mixed Chars',
      body: 'Ref: GBR/2024-03/99887766 — Address: Flat 4/C, 22-24 Queen\'s Gate Terrace, London SW7 5PH — Doc: P<GBR<<JONES<<DAVID<PAUL<<<<<<<<<< — Expiry: 31/12/2029',
      mode: 'TIMED_DRILL', durationSeconds: 180, difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'address', 'document-number']),
    },
    {
      title: 'Address + MRZ Combined',
      body: 'Permanent Address: 77-B Rajouri Garden, New Delhi 110027 — Passport: J8901234 — MRZ:\nP<INDKUMAR<<RAHUL<SINGH<<<<<<<<<<<<<<<<<<\nJ8901234IND9302155M2902150<<<<<<<<<3',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport', 'address']),
    },
    {
      title: 'Hard Timed Drill 5min — Full Verification',
      body: 'VERIFICATION RECORD — ID: VER/2024/UK/003342\nName: O\'SULLIVAN, Patrick James — DOB: 29-02-1988 — Nationality: IRL\nPassport: IA1234567 — Issue: 01/03/2020 — Expiry: 01/03/2030\nAddress: 14A Fitzwilliam Square, Dublin 2, D02 XH97, Ireland\nMRZ: P<IRLOSULLIVAN<<PATRICK<JAMES<<<<<<<<<<<\nIA1234567IRL8802295M3003013<<<<<<<<<2',
      mode: 'TIMED_DRILL', durationSeconds: 300, difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport', 'address', 'document-number']),
    },
  ];

  for (const p of prompts) {
    const existing = await prisma.typingPrompt.findFirst({ where: { title: p.title } });
    if (!existing) {
      await prisma.typingPrompt.create({ data: { ...p, isActive: true } });
    }
  }
  console.log(`[seed] typing_prompts: ${prompts.length} passages ensured.`);
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
  await seedTypingPrompts();

  if (process.env.LMS_ALLOW_DEMO_SEED === 'true') {
    await seedDemoEnvironment();
  } else {
    console.log('Demo data skipped. Set LMS_ALLOW_DEMO_SEED=true in a non-production environment to enable it.');
  }
}

main()
  .catch(error => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
