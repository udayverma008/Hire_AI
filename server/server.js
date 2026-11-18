'use strict';
const { createApp, readBody } = require('./app');
const { localStorage, mongoStorage } = require('./storage');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'hireai.json');
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const production = process.env.NODE_ENV === 'production';
let db;
const attempts = new Map();

const starterJobs = [
  { id: 'job-product-designer', title: 'Product Designer', company: 'Northstar Studio', location: 'Remote', type: 'Full-time', category: 'Design', salary: '₹18–24 LPA', description: 'Help shape thoughtful digital experiences for people doing meaningful work. Partner with product, engineering, and research to turn complex problems into clear, accessible interfaces.', requirements: ['Product design craft and a portfolio', 'Figma and prototyping', 'Clear communication and collaboration'] },
  { id: 'job-frontend-engineer', title: 'Frontend Engineer', company: 'Linear Labs', location: 'Bengaluru · Hybrid', type: 'Full-time', category: 'Engineering', salary: '₹22–30 LPA', description: 'Build reliable, accessible product experiences with a close-knit engineering and design team.', requirements: ['JavaScript and modern browser APIs', 'Frontend architecture', 'Accessibility fundamentals'] },
  { id: 'job-ux-researcher', title: 'UX Researcher', company: 'Goodwell', location: 'Remote', type: 'Contract', category: 'Design', salary: '₹12–18 LPA', description: 'Plan and run research that helps the team understand customer needs and improve the product.', requirements: ['Interview and usability research', 'Synthesis and clear reporting', 'Collaborative approach'] },
  { id: 'job-marketing-manager', title: 'Product Marketing Manager', company: 'Brightside', location: 'Mumbai · Hybrid', type: 'Full-time', category: 'Marketing', salary: '₹20–28 LPA', description: 'Connect product value with the people who need it through clear positioning and thoughtful launches.', requirements: ['Go-to-market planning', 'Strong writing', 'Marketing analytics'] },
  { id: 'job-data-analyst', title: 'Data Analyst', company: 'Orbit Finance', location: 'Remote', type: 'Full-time', category: 'Engineering', salary: '₹15–21 LPA', description: 'Turn product and customer data into useful decisions for teams across the company.', requirements: ['SQL and data modeling', 'Dashboards and visualization', 'Experimental thinking'] },
  { id: 'job-visual-designer', title: 'Visual Designer', company: 'Fieldwork', location: 'Pune · On-site', type: 'Full-time', category: 'Design', salary: '₹10–16 LPA', description: 'Create a coherent visual language across brand and product touchpoints.', requirements: ['Visual design portfolio', 'Brand systems', 'Motion experience is a plus'] }
];
function emptyStore() { return { users: [], jobs: starterJobs.map(job => ({ ...job, ownerId: null, createdAt: new Date().toISOString() })), applications: [], savedJobs: [] }; }
function publicUser(user) { const { passwordHash, passwordSalt, ...safe } = user; return safe; }
function send(res, status, data, headers = {}) { const body = JSON.stringify(data); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(body); }
function fail(res, status, message) { send(res, status, { error: message }); }
function sessionToken(req) {
  return (req.headers.cookie || '').match(/(?:^|;\s*)hireai_session=([\w-]{43})(?:;|$)/)?.[1];
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
async function currentUser(req) {
  const token = sessionToken(req);
  const session = token && await db.sessions.find({ tokenHash: hashToken(token) });
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return await db.users.find({ id: session.userId });
}
function loginCookie(req, token, maxAge) {
  return 'hireai_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge +
    (production || req.secure ? '; Secure' : '');
}
async function issueSession(req, res, user) {
  const previous = sessionToken(req);
  if (previous) await db.sessions.remove({ tokenHash: hashToken(previous) });
  const token = crypto.randomBytes(32).toString('base64url');
  await db.sessions.insert({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL) });
  send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': loginCookie(req, token, SESSION_TTL / 1000) });
}
async function requireUser(req, res, role) {
  const user = await currentUser(req);
  if (!user) { fail(res, 401, 'Please sign in to continue.'); return null; }
  if (role && user.role !== role) { fail(res, 403, 'This action requires a ' + role + ' account.'); return null; }
  return user;
}
function rateLimited(req) { const key = req.ip || 'unknown'; const now = Date.now(); const entry = attempts.get(key) || { count: 0, since: now }; if (now - entry.since > 15 * 60 * 1000) { entry.count = 0; entry.since = now; } entry.count++; attempts.set(key, entry); return entry.count > 12; }
function cleanText(value, max = 4000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function safeJob(job) { const { ownerId, ...publicFields } = job; return publicFields; }
async function applicationsFor(user, ownedJobs) {
  const recruiter = user.role === 'Recruiter';
  const jobs = recruiter ? ownedJobs ?? await db.jobs.list({ ownerId: user.id }) : [];
  const applications = await db.applications.list(recruiter
    ? { jobId: { $in: jobs.map(job => job.id) } }
    : { candidateId: user.id });
  const relatedJobs = recruiter ? jobs : await db.jobs.list({ id: { $in: applications.map(application => application.jobId) } });
  const byId = new Map(relatedJobs.map(job => [job.id, job]));
  const candidates = recruiter ? await db.users.list({ id: { $in: applications.map(application => application.candidateId) } }) : [];
  const candidateById = new Map(candidates.map(candidate => [candidate.id, publicUser(candidate)]));
  return applications.map(application => ({
    ...application,
    job: byId.get(application.jobId),
    candidate: candidateById.get(application.candidateId)
  }));
}
async function handleApi(req, res, url) {
  const method = req.method, pathname = url.pathname;
  if (method === 'GET' && pathname === '/api/auth/me') { const user = await currentUser(req); return user ? send(res, 200, { user: publicUser(user) }) : fail(res, 401, 'Not signed in.'); }
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req); const name = cleanText(body.name, 100), email = cleanText(body.email, 254).toLowerCase(), password = typeof body.password === 'string' ? body.password : '', role = body.role === 'Recruiter' ? 'Recruiter' : body.role === 'Candidate' ? 'Candidate' : '';
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 200 || !role) return fail(res, 400, 'Enter a name, valid email, password with at least 8 characters, and account type.');
    const passwordSalt = crypto.randomBytes(16).toString('hex'); const passwordHash = (await scrypt(password, passwordSalt, 64)).toString('hex');
    const user = { id: crypto.randomUUID(), name, email, role, headline: '', location: '', summary: '', skills: '', company: '', createdAt: new Date().toISOString(), passwordSalt, passwordHash };
    try {
      await db.users.insert(user);
    } catch (error) {
      if (error.code !== 11000) throw error;
      return fail(res, 409, 'An account with this email already exists.');
    }
    return issueSession(req, res, user);
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    if (rateLimited(req)) return fail(res, 429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const body = await readBody(req); const email = cleanText(body.email, 254).toLowerCase(), password = typeof body.password === 'string' ? body.password : ''; const user = await db.users.find({ email });
    if (!user || password.length > 200 || !(await scrypt(password, user.passwordSalt, 64)).equals(Buffer.from(user.passwordHash, 'hex'))) return fail(res, 401, 'Email or password is incorrect.');
    attempts.delete(req.ip || 'unknown'); return issueSession(req, res, user);
  }
  if (method === 'POST' && pathname === '/api/auth/logout') { const token = sessionToken(req); if (token) await db.sessions.remove({ tokenHash: hashToken(token) }); return send(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(req, '', 0) }); }
  if (method === 'GET' && pathname === '/api/jobs') {
    const keyword = (url.searchParams.get('keyword') || '').toLowerCase(), location = (url.searchParams.get('location') || '').toLowerCase(), type = (url.searchParams.get('type') || '').toLowerCase(), category = (url.searchParams.get('category') || '').toLowerCase();
    let jobs = (await db.jobs.list()).filter(job => (!keyword || `${job.title} ${job.company} ${job.category} ${job.description} ${(job.requirements || []).join(' ')}`.toLowerCase().includes(keyword)) && (!location || job.location.toLowerCase().includes(location)) && (!type || job.type.toLowerCase().includes(type)) && (!category || job.category.toLowerCase().includes(category)));
    if (url.searchParams.get('sort') === 'newest') jobs = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return send(res, 200, { jobs: jobs.map(safeJob) });
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (method === 'GET' && jobMatch) { const job = await db.jobs.find({ id: jobMatch[1] }); return job ? send(res, 200, { job }) : fail(res, 404, 'Job not found.'); }
  const applicationMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/applications$/);
  if (method === 'POST' && applicationMatch) {
    const user = await requireUser(req, res, 'Candidate'); if (!user) return; const job = await db.jobs.find({ id: applicationMatch[1] }); if (!job) return fail(res, 404, 'Job not found.');
    const body = await readBody(req); const application = { id: crypto.randomUUID(), jobId: job.id, candidateId: user.id, coverNote: cleanText(body.coverNote, 3000), status: 'Submitted', createdAt: new Date().toISOString() };
    try {
      await db.applications.insert(application);
    } catch (error) {
      if (error.code !== 11000) throw error;
      return fail(res, 409, 'You have already applied to this role.');
    }
    return send(res, 201, { application });
  }
  if (method === 'POST' && pathname === '/api/jobs') {
    const user = await requireUser(req, res, 'Recruiter'); if (!user) return; const body = await readBody(req);
    const title = cleanText(body.title, 120), company = cleanText(body.company || user.company || user.name, 120), location = cleanText(body.location, 120), type = cleanText(body.type, 40), category = cleanText(body.category, 60), salary = cleanText(body.salary, 80), description = cleanText(body.description, 5000);
    if (!title || !company || !location || !type || !category || !description) return fail(res, 400, 'Complete all required job fields.');
    const job = { id: crypto.randomUUID(), title, company, location, type, category, salary, description, requirements: Array.isArray(body.requirements) ? body.requirements.map(x => cleanText(x, 180)).filter(Boolean).slice(0, 20) : [], ownerId: user.id, createdAt: new Date().toISOString() }; await db.jobs.insert(job); return send(res, 201, { job });
  }
  const savedMatch = pathname.match(/^\/api\/saved-jobs(?:\/([\w-]+))?$/);
  if (method === 'GET' && pathname === '/api/saved-jobs') {
    const user = await requireUser(req, res, 'Candidate');
    if (!user) return;
    const saved = await db.savedJobs.list({ candidateId: user.id });
    const jobs = await db.jobs.list({ id: { $in: saved.map(item => item.jobId) } });
    return send(res, 200, { jobs });
  }
  if (savedMatch?.[1] && (method === 'POST' || method === 'DELETE')) {
    const user = await requireUser(req, res, 'Candidate');
    if (!user) return;
    const key = { candidateId: user.id, jobId: savedMatch[1] };
    if (method === 'DELETE') {
      await db.savedJobs.remove(key);
      return send(res, 200, { saved: false });
    }
    if (!await db.jobs.find({ id: key.jobId })) return fail(res, 404, 'Job not found.');
    await db.savedJobs.insert({ ...key, createdAt: new Date().toISOString() }, { ignoreDuplicate: true });
    return send(res, 201, { saved: true });
  }
  if (method === 'GET' && pathname === '/api/applications/mine') {
    const user = await requireUser(req, res);
    if (!user) return;
    return send(res, 200, { applications: await applicationsFor(user) });
  }
  const statusMatch = pathname.match(/^\/api\/applications\/([\w-]+)$/);
  if (method === 'PATCH' && statusMatch) {
    const user = await requireUser(req, res, 'Recruiter'); if (!user) return; const application = await db.applications.find({ id: statusMatch[1] }); if (!application || !await db.jobs.find({ id: application.jobId, ownerId: user.id })) return fail(res, 404, 'Application not found.');
    const body = await readBody(req); if (!['In review', 'Shortlisted', 'Rejected', 'Hired'].includes(body.status)) return fail(res, 400, 'Choose a valid application status.'); const updated = await db.applications.update({ id: application.id }, { status: body.status }); return send(res, 200, { application: updated });
  }
  if (method === 'GET' && pathname === '/api/profile') { const user = await requireUser(req, res); return user ? send(res, 200, { profile: publicUser(user) }) : undefined; }
  if (method === 'PATCH' && pathname === '/api/profile') {
    const user = await requireUser(req, res); if (!user) return; const body = await readBody(req); const fields = {};
    for (const key of ['name', 'headline', 'location', 'summary', 'skills', 'company']) {
      if (typeof body[key] === 'string') fields[key] = cleanText(body[key], key === 'summary' ? 4000 : 300);
    }
    const updated = Object.keys(fields).length ? await db.users.update({ id: user.id }, fields) : user;
    return send(res, 200, { profile: publicUser(updated) });
  }
  if (method === 'GET' && pathname === '/api/dashboard/candidate') {
    const user = await requireUser(req, res, 'Candidate'); if (!user) return; const applications = await applicationsFor(user); const profileFields = ['headline', 'location', 'summary', 'skills']; const complete = profileFields.filter(key => user[key]).length;
    return send(res, 200, { user: publicUser(user), applications, profileCompleteness: Math.round((complete / profileFields.length) * 100) });
  }
  if (method === 'GET' && pathname === '/api/dashboard/recruiter') {
    const user = await requireUser(req, res, 'Recruiter'); if (!user) return; const jobs = await db.jobs.list({ ownerId: user.id }); const applications = await applicationsFor(user, jobs); return send(res, 200, { user: publicUser(user), jobs, applications });
  }
  return fail(res, 404, 'API route not found.');
}
async function start() {
  const uri = process.env.MONGODB_URI;
  if (production && !uri) throw new Error('MONGODB_URI is required in production.');
  db = uri ? await mongoStorage(uri) : localStorage(DATA_FILE, emptyStore());
  if (uri && process.env.SEED_DEMO_JOBS === 'true') {
    for (const job of emptyStore().jobs) await db.jobs.insert(job, { ignoreDuplicate: true });
  }
  const frontendOrigin = process.env.FRONTEND_ORIGIN;
  if (frontendOrigin && new URL(frontendOrigin).origin !== frontendOrigin) {
    throw new Error('FRONTEND_ORIGIN must be an origin without a trailing slash or path.');
  }
  const app = createApp({ root: ROOT, handleApi, frontendOrigin });
  if (process.env.TRUST_PROXY_HOPS) {
    const hops = Number(process.env.TRUST_PROXY_HOPS);
    if (!Number.isSafeInteger(hops) || hops < 1) throw new Error('TRUST_PROXY_HOPS must be a positive integer.');
    app.set('trust proxy', hops);
  }
  const server = app.listen(PORT, () => console.log('HireAI is ready at http://localhost:' + server.address().port));
  server.on('error', error => { throw error; });
}

start().catch(error => {
  console.error('HireAI startup failed:', error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[MongoDB URI]'));
  process.exit(1);
});
