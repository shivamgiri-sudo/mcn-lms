import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { prisma } from '../utils/db.js';
import { requireSession } from '../middleware/auth.js';
import * as cache from '../utils/cache.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(__dirname, '..', '..', 'uploads', 'content');
const contentFileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { ok: false, message: 'Too many content file requests. Try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const OFFICE_MIME_BY_EXT = {
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Uploaded HTML is untrusted, so it runs in a CSP sandbox WITHOUT allow-same-origin:
// its scripts execute (interactive pages work) but in an opaque origin with no access
// to this site's cookies, storage or API - even if the file is opened directly rather
// than through the viewer iframe. The global policy (script-src 'self') would block
// every inline script, hence the dedicated header.
const HTML_CONTENT_CSP = [
  'sandbox allow-scripts allow-forms',
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  'img-src data: blob: https:',
  'font-src data: https:',
  'media-src data: blob: https:',
  'connect-src https:',
  "frame-ancestors 'self'",
].join('; ');

// Injected into the served page so the viewer can tell whether the learner has seen
// all of it: elements marked data-lms-section must each be scrolled into view (or
// clicked); a page with none must be scrolled to the end. Progress goes to the parent
// frame via postMessage.
const HTML_TRACKER = `<script>(function(){
var secs=[].slice.call(document.querySelectorAll('[data-lms-section]')),seen={},st={source:'lms-html',visited:0,total:secs.length,atEnd:false};
function post(){try{parent.postMessage(st,'*')}catch(e){}}
function end(){var d=document.documentElement;st.atEnd=(window.innerHeight+window.scrollY)>=d.scrollHeight-24}
function mark(i){if(i>=0&&!seen[i]){seen[i]=1;st.visited++}}
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){
if(e.intersectionRect.height>=Math.min(e.boundingClientRect.height*0.5,window.innerHeight*0.4)&&e.intersectionRect.height>0){mark(secs.indexOf(e.target));io.unobserve(e.target);post()}})},{threshold:[0,0.1,0.25,0.5,0.75,1]});
secs.forEach(function(s){io.observe(s)})}else{secs.forEach(function(s,i){mark(i)})}
secs.forEach(function(s,i){s.addEventListener('click',function(){mark(i);post()})});
window.addEventListener('scroll',function(){end();post()},{passive:true});window.addEventListener('resize',function(){end();post()});
end();post();setInterval(function(){end();post()},2000)})();</script>`;

async function sendHtmlContent(res, target) {
  const html = await fs.promises.readFile(target, 'utf8');
  const at = html.toLowerCase().lastIndexOf('</body>');
  const page = at === -1 ? html + HTML_TRACKER : html.slice(0, at) + HTML_TRACKER + html.slice(at);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', HTML_CONTENT_CSP);
  return res.send(page);
}

function safeFilename(value) {
  const decoded = decodeURIComponent(String(value || ''));
  if (!decoded || decoded !== path.basename(decoded) || decoded.includes('\0')) return '';
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(decoded)) return '';
  return decoded;
}

// A file can reach a trainee two ways, and this guard has to know about both.
// Checking only classroom content meant every Content Repository upload delivered
// through an independent module was fetched, then refused with "not assigned to
// your classroom" - the file was genuinely assigned, just not via content_master.
async function allowedByClassroom(employeeId, filename) {
  const contents = await prisma.contentMaster.findMany({
    where: {
      active: true,
      directMediaUrl: { endsWith: `/${filename}` },
      module: { active: true },
    },
    select: {
      module: { select: { classroomId: true } },
    },
    take: 100,
  });

  const classroomIds = [...new Set(contents.map(row => row.module?.classroomId).filter(Boolean))];
  if (!classroomIds.length) return false;

  const trainee = await prisma.traineeMaster.findUnique({
    where: { employeeId },
    select: { classroomId: true },
  });
  if (trainee?.classroomId && classroomIds.includes(trainee.classroomId)) return true;

  const mapping = await prisma.traineeClassroomMap.findFirst({
    where: { employeeId, classroomId: { in: classroomIds }, active: true },
    select: { id: true },
  });
  return Boolean(mapping);
}

// A sentinel no real batch/process/branch can equal, so a trainee with an empty
// batchNo does not match assignments whose assignedTo is also empty.
const NO_MATCH = '__unassigned__';

// Mirrors getDirectAssignments in routes/traineeStability.js - the same scopes the
// dashboard uses to decide the trainee may see the module in the first place.
async function allowedByIndependentModule(employeeId, filename) {
  const repoRows = await prisma.$queryRawUnsafe(
    `SELECT repository_content_id FROM content_repository_master
      WHERE status = 'Active' AND direct_media_url LIKE ? LIMIT 100`,
    `%/${filename}`,
  );
  const repoIds = (repoRows || []).map(row => row.repository_content_id).filter(Boolean);
  if (!repoIds.length) return false;

  const placeholders = repoIds.map(() => '?').join(',');
  const mapRows = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT m.module_id FROM independent_module_content_map m
      INNER JOIN independent_module_master im ON im.module_id = m.module_id AND im.status = 'Active'
      WHERE m.active = 1 AND m.repository_content_id IN (${placeholders})`,
    ...repoIds,
  );
  const moduleIds = (mapRows || []).map(row => row.module_id).filter(Boolean);
  if (!moduleIds.length) return false;

  const trainee = await prisma.traineeMaster.findUnique({
    where: { employeeId },
    select: { batchNo: true, process: true, branch: true },
  });

  const assignment = await prisma.assignedModule.findFirst({
    where: {
      active: true,
      moduleId: { in: moduleIds },
      OR: [
        { assignedTo: employeeId, assignedToType: 'individual' },
        { assignedTo: trainee?.batchNo || NO_MATCH, assignedToType: 'batch' },
        { assignedTo: trainee?.process || NO_MATCH, assignedToType: 'process' },
        { assignedTo: trainee?.branch || NO_MATCH, assignedToType: 'branch' },
        { assignedToType: 'company' },
      ],
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function traineeCanAccess(employeeId, filename) {
  if (await allowedByClassroom(employeeId, filename)) return true;
  return allowedByIndependentModule(employeeId, filename);
}

router.get('/files/:filename', contentFileLimiter, requireSession, async (req, res, next) => {
  try {
    const filename = safeFilename(req.params.filename);
    if (!filename) return res.status(400).json({ ok: false, message: 'Invalid content filename.' });

    const target = path.resolve(contentRoot, filename);
    if (!target.startsWith(`${contentRoot}${path.sep}`)) {
      return res.status(400).json({ ok: false, message: 'Invalid content path.' });
    }

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat?.isFile()) return res.status(404).json({ ok: false, message: 'Content file not found.' });

    if (req.userType === 'trainee' && !await traineeCanAccess(req.userId, filename)) {
      return res.status(403).json({ ok: false, message: 'This file is not assigned to your classroom.' });
    }
    if (!['trainee', 'coordinator', 'admin'].includes(req.userType)) {
      return res.status(403).json({ ok: false, message: 'Learning-content access denied.' });
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replaceAll('"', '')}"`);
    if (/\.html?$/i.test(filename)) return await sendHtmlContent(res, target);
    return res.sendFile(filename, { root: contentRoot, dotfiles: 'deny', acceptRanges: true });
  } catch (error) {
    return next(error);
  }
});

// Redeems a token minted by POST /trainee/content/:contentId/preview-token
// (routes/traineeStability.js) -- deliberately NOT session-gated, because
// Microsoft's Office Online embed viewer fetches this URL itself and cannot
// carry our session cookie. Access control already happened when the token
// was issued (the normal requireContentAccess check); this only has to
// confirm the opaque, short-lived (5 min), 192-bit random token is one this
// server actually minted and hasn't expired. The trailing :displayName
// segment is purely cosmetic -- Office Online's viewer sniffs the file type
// from the URL's own extension and fails with a generic error on an
// extensionless URL even though the file streams fine, so the token
// endpoint hands back a display filename to put there. It is NEVER used to
// locate the actual file (that's resolved from the token alone), so there
// is nothing to guess or enumerate by tampering with it.
router.get('/preview/:token/:displayName', contentFileLimiter, async (req, res) => {
  try {
    const record = cache.get(`office-preview:${req.params.token}`);
    if (!record) return res.status(404).json({ ok: false, message: 'This preview link has expired. Reopen the content to try again.' });

    const content = await prisma.contentMaster.findUnique({ where: { contentId: record.contentId } });
    if (!content || !content.active) return res.status(404).json({ ok: false, message: 'Content not found.' });

    const source = content.directMediaUrl || content.localFilePath || '';
    // A query string on directMediaUrl would otherwise land inside "filename"
    // and fail safeFilename's strict character check for a file that's
    // actually fine -- strip it the same way the frontend's own
    // protectedLocalUrl (useTrackedContentViewer.jsx) already does.
    const pathOnly = source.split('?')[0];
    const filename = safeFilename(pathOnly.split('/').pop());
    if (!filename) return res.status(404).json({ ok: false, message: 'No local file for this content.' });

    const target = path.resolve(contentRoot, filename);
    if (!target.startsWith(`${contentRoot}${path.sep}`)) return res.status(400).json({ ok: false, message: 'Invalid content path.' });

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat?.isFile()) return res.status(404).json({ ok: false, message: 'Content file not found.' });

    const ext = filename.split('.').pop().toLowerCase();
    res.setHeader('Content-Type', OFFICE_MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replaceAll('"', '')}"`);
    return res.sendFile(filename, { root: contentRoot, dotfiles: 'deny', acceptRanges: true });
  } catch (error) {
    console.error('[contentFiles] office preview stream failed:', error.message);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
