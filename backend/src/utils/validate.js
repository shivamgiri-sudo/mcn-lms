import { z } from 'zod';

export const loginSchema = z.object({
  loginId: z.string().min(1, 'Login ID required'),
  pin: z.string().min(1, 'PIN required'),
});

export const adminLoginSchema = z.object({
  adminId: z.string().min(1, 'Admin ID required'),
  password: z.string().min(1, 'Password required'),
});

export const traineeLoginSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID required'),
  password: z.string().min(1, 'Password required'),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(1, 'Identifier required'),
});

export const classroomSchema = z.object({
  classroomName: z.string().min(1, 'Classroom name required'),
  process: z.string().optional().nullable(),
  lob: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  driveFolderId: z.string().optional().nullable(),
  driveFolderUrl: z.string().optional().nullable(),
});

export const moduleSchema = z.object({
  dayNo: z.number().int().positive('Day number must be positive'),
  moduleTitle: z.string().min(1, 'Module title required'),
  moduleOrder: z.number().int().optional().default(0),
  required: z.boolean().optional().default(true),
  description: z.string().optional().nullable(),
});

export const contentSchema = z.object({
  contentType: z.string().optional().default('video'),
  contentTitle: z.string().optional(),
  driveFileId: z.string().optional().nullable(),
  driveUrl: z.string().optional().nullable(),
  directMediaUrl: z.string().optional().nullable(),
  playerMode: z.string().optional().default('Auto'),
  contentOrder: z.number().int().optional(),
  required: z.boolean().optional().default(true),
  estimatedMins: z.number().int().optional().default(0),
  completionRulePct: z.number().min(0).max(100).optional().default(80),
  description: z.string().optional().nullable(),
});

// Browser forms post empty strings for numeric fields the user never touched,
// and number inputs arrive as strings. Normalise both to a number or absent so
// the schema accepts what the controllers already handle.
const formNumber = value => {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
};

// Same idea as formNumber, but for optional strings — a "-- No classroom (standalone) --"
// select posts '' rather than omitting the field entirely, which would otherwise fail a
// .min(1) on an "optional" string (optional only means undefined/missing is allowed, not '').
const formOptionalString = value => (value === '' ? undefined : value);

export const assessmentSchema = z.object({
  assessmentName: z.string().min(1, 'Assessment name required'),
  // Optional — a standalone assessment (no classroom yet) has this omitted/null
  // and can be attached to a classroom later via attach-classroom.
  classroomId: z.preprocess(formOptionalString, z.string().min(1).optional().nullable()),
  dayNo: z.preprocess(formNumber, z.number().int().optional().nullable()),
  moduleId: z.preprocess(formOptionalString, z.string().optional().nullable()),
  sortOrder: z.preprocess(formNumber, z.number().int().optional().default(0)),
  passingPct: z.preprocess(formNumber, z.number().min(0).max(100).optional().default(60)),
  attemptLimit: z.preprocess(formNumber, z.number().int().min(1).optional().default(3)),
  timeLimitMins: z.preprocess(formNumber, z.number().int().min(1).optional().default(30)),
  instructions: z.string().optional().nullable(),
});

// Both create-batch controllers generate batchNo themselves and fall back to
// a process/LOB derived batchName, so neither may be demanded from the client.
export const batchSchema = z.object({
  batchNo: z.string().optional().nullable(),
  batchName: z.string().optional().nullable(),
  batchType: z.string().optional().default('NHT'),
  branch: z.string().optional().nullable(),
  process: z.string().optional().nullable(),
  lob: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  expectedTrainees: z.preprocess(formNumber, z.number().int().optional().default(0)),
  remarks: z.string().optional().nullable(),
});

export const traineeSchema = z.object({
  traineeName: z.string().min(1, 'Name required'),
  email: z.string().email().optional().nullable().or(z.literal('')),
  mobile: z.string().optional().nullable(),
  batchNo: z.string().optional().nullable(),
  branch: z.string().optional().nullable(),
  process: z.string().optional().nullable(),
  lob: z.string().optional().nullable(),
  classroomId: z.string().optional().nullable(),
});

export const querySchema = z.object({
  question: z.string().min(1, 'Question required'),
  category: z.string().optional().default('Process Doubt'),
});

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // zod v4 exposes .issues; v3 exposed .errors. Read both so a failed
      // validation returns 400 instead of throwing inside the middleware.
      const issues = result.error.issues || result.error.errors || [];
      const first = issues[0];
      return res.status(400).json({ ok: false, message: first?.message || 'Validation error', errors: issues });
    }
    req.validated = result.data;
    next();
  };
}
