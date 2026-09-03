import { prisma } from '../utils/db.js';

// Branch, process and LOB were free-text inputs on ten different forms, so every
// typo minted a new branch. Now that access control keys on the branch string, a
// typo silently revokes access - these lists are the single source the forms pick
// from. The master tables are authoritative, but values already in use are unioned
// in so no existing record becomes unselectable.
function tidy(values) {
  const seen = new Map();
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) seen.set(key, text);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export async function getFormOptions() {
  const [branchRows, processLobRows, batchBranches, classroomBranches, traineeBranches] = await Promise.all([
    prisma.branchMaster.findMany({ where: { active: true }, select: { branchName: true } }),
    prisma.processLobMaster.findMany({ where: { active: true }, select: { process: true, lob: true } }),
    prisma.batchMaster.findMany({ where: { branch: { not: null } }, select: { branch: true }, distinct: ['branch'] }),
    prisma.classroomMaster.findMany({ where: { branch: { not: null } }, select: { branch: true }, distinct: ['branch'] }),
    prisma.traineeMaster.findMany({ where: { branch: { not: null } }, select: { branch: true }, distinct: ['branch'] }),
  ]);

  const branches = tidy([
    ...branchRows.map(row => row.branchName),
    ...batchBranches.map(row => row.branch),
    ...classroomBranches.map(row => row.branch),
    ...traineeBranches.map(row => row.branch),
  ]);

  const processLob = processLobRows
    .map(row => ({ process: String(row.process || '').trim(), lob: String(row.lob || '').trim() }))
    .filter(row => row.process);

  return {
    branches,
    processes: tidy(processLob.map(row => row.process)),
    lobs: tidy(processLob.map(row => row.lob)),
    processLob,
  };
}

// Coordinators only ever work inside their own branch, so offering them the other
// 38 is a way to file a batch somewhere they cannot then open it.
export function scopeFormOptions(options, branch) {
  if (!branch) return options;
  return { ...options, branches: options.branches.filter(item => item.toLowerCase() === String(branch).toLowerCase()) };
}
