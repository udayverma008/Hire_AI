'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { URL } = require('node:url');
const scrypt = promisify(crypto.scrypt);
const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'hireai.json');
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
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
fs.mkdirSync(DATA_DIR, { recursive: true });
let store;
if (fs.existsSync(DATA_FILE)) { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
else { store = emptyStore(); writeStore(); }
store.savedJobs ||= [];
store.applications ||= [];
function writeStore() { const temp = `${DATA_FILE}.tmp`; fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 }); fs.renameSync(temp, DATA_FILE); }
function publicUser(user) { const { passwordHash, passwordSalt, ...safe } = user; return safe; }
function send(res, status, data, headers = {}) { const body = JSON.stringify(data); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(body); }
function fail(res, status, message) { send(res, status, { error: message }); }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim()).filter(Boolean).map(part => { const index = part.indexOf('='); return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; })); }
function currentUser(req) { const token = cookies(req).hireai_session; const session = token && sessions.get(token); if (!session) return null; if (session.expiresAt < Date.now()) { sessions.delete(token); return null; } return store.users.find(user => user.id === session.userId) || null; }
function loginCookie(req, token, maxAge) { return `hireai_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`; }
function issueSession(req, res, user) { const token = crypto.randomBytes(32).toString('base64url'); sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL }); send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': loginCookie(req, token, SESSION_TTL / 1000) }); }
function requireUser(req, res, role) { const user = currentUser(req); if (!user) { fail(res, 401, 'Please sign in to continue.'); return null; } if (role && user.role !== role) { fail(res, 403, `This action requires a ${role} account.`); return null; } return user; }
async function readBody(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1024 * 1024) throw Object.assign(new Error('Request body is too large.'), { status: 413 }); } if (!raw) return {}; try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); } }
function rateLimited(req) { const key = req.socket.remoteAddress || 'unknown'; const now = Date.now(); const entry = attempts.get(key) || { count: 0, since: now }; if (now - entry.since > 15 * 60 * 1000) { entry.count = 0; entry.since = now; } entry.count++; attempts.set(key, entry); return entry.count > 12; }
function cleanText(value, max = 4000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function safeJob(job) { const { ownerId, ...publicFields } = job; return publicFields; }
function appJob(jobId) { return store.jobs.find(job => job.id === jobId); }
function serveStatic(req, res, pathname) {
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return fail(res, 400, 'Invalid path.'); }
  if (decoded === '/') decoded = '/index.html';
  let target;
  if (decoded === '/index.html') target = path.join(ROOT, 'index.html');
  else if (decoded.startsWith('/client/')) {
    target = path.resolve(CLIENT, `.${decoded.slice('/client'.length)}`);
    if (!target.startsWith(CLIENT + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return fail(res, 404, 'Page not found.');
  } else return fail(res, 404, 'Page not found.');
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' }[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); fs.createReadStream(target).pipe(res);
}
async function handleApi(req, res, url) {
  const method = req.method, pathname = url.pathname;
  if (method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, service: 'HireAI API' });
  if (method === 'GET' && pathname === '/api/auth/me') { const user = currentUser(req); return user ? send(res, 200, { user: publicUser(user) }) : fail(res, 401, 'Not signed in.'); }
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req); const name = cleanText(body.name, 100), email = cleanText(body.email, 254).toLowerCase(), password = typeof body.password === 'string' ? body.password : '', role = body.role === 'Recruiter' ? 'Recruiter' : body.role === 'Candidate' ? 'Candidate' : '';
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 200 || !role) return fail(res, 400, 'Enter a name, valid email, password with at least 8 characters, and account type.');
    if (store.users.some(user => user.email === email)) return fail(res, 409, 'An account with this email already exists.');
    const passwordSalt = crypto.randomBytes(16).toString('hex'); const passwordHash = (await scrypt(password, passwordSalt, 64)).toString('hex');
    if (store.users.some(user => user.email === email)) return fail(res, 409, 'An account with this email already exists.');
    const user = { id: crypto.randomUUID(), name, email, role, headline: '', location: '', summary: '', skills: '', company: '', createdAt: new Date().toISOString(), passwordSalt, passwordHash };
    store.users.push(user); writeStore(); return issueSession(req, res, user);
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    if (rateLimited(req)) return fail(res, 429, 'Too many sign-in attempts. Wait 15 minutes and try again.');
    const body = await readBody(req); const email = cleanText(body.email, 254).toLowerCase(), password = typeof body.password === 'string' ? body.password : ''; const user = store.users.find(item => item.email === email);
    if (!user || !(await scrypt(password, user.passwordSalt, 64)).equals(Buffer.from(user.passwordHash, 'hex'))) return fail(res, 401, 'Email or password is incorrect.');
    attempts.delete(req.socket.remoteAddress || 'unknown'); return issueSession(req, res, user);
  }
  if (method === 'POST' && pathname === '/api/auth/logout') { const token = cookies(req).hireai_session; if (token) sessions.delete(token); return send(res, 200, { ok: true }, { 'Set-Cookie': loginCookie(req, '', 0) }); }
  if (method === 'GET' && pathname === '/api/jobs') {
    const keyword = (url.searchParams.get('keyword') || '').toLowerCase(), location = (url.searchParams.get('location') || '').toLowerCase(), type = (url.searchParams.get('type') || '').toLowerCase(), category = (url.searchParams.get('category') || '').toLowerCase();
    let jobs = store.jobs.filter(job => (!keyword || `${job.title} ${job.company} ${job.category} ${job.description} ${(job.requirements || []).join(' ')}`.toLowerCase().includes(keyword)) && (!location || job.location.toLowerCase().includes(location)) && (!type || job.type.toLowerCase().includes(type)) && (!category || job.category.toLowerCase().includes(category)));
    if (url.searchParams.get('sort') === 'newest') jobs = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return send(res, 200, { jobs: jobs.map(safeJob) });
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (method === 'GET' && jobMatch) { const job = appJob(jobMatch[1]); return job ? send(res, 200, { job }) : fail(res, 404, 'Job not found.'); }
  const applicationMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/applications$/);
  if (method === 'POST' && applicationMatch) {
    const user = requireUser(req, res, 'Candidate'); if (!user) return; const job = appJob(applicationMatch[1]); if (!job) return fail(res, 404, 'Job not found.');
    if (store.applications.some(application => application.jobId === job.id && application.candidateId === user.id)) return fail(res, 409, 'You have already applied to this role.');
    const body = await readBody(req); const application = { id: crypto.randomUUID(), jobId: job.id, candidateId: user.id, coverNote: cleanText(body.coverNote, 3000), status: 'Submitted', createdAt: new Date().toISOString() }; store.applications.push(application); writeStore(); return send(res, 201, { application });
  }
  if (method === 'POST' && pathname === '/api/jobs') {
    const user = requireUser(req, res, 'Recruiter'); if (!user) return; const body = await readBody(req);
    const title = cleanText(body.title, 120), company = cleanText(body.company || user.company || user.name, 120), location = cleanText(body.location, 120), type = cleanText(body.type, 40), category = cleanText(body.category, 60), salary = cleanText(body.salary, 80), description = cleanText(body.description, 5000);
    if (!title || !company || !location || !type || !category || !description) return fail(res, 400, 'Complete all required job fields.');
    const job = { id: crypto.randomUUID(), title, company, location, type, category, salary, description, requirements: Array.isArray(body.requirements) ? body.requirements.map(x => cleanText(x, 180)).filter(Boolean).slice(0, 20) : [], ownerId: user.id, createdAt: new Date().toISOString() }; store.jobs.unshift(job); writeStore(); return send(res, 201, { job });
  }
  const savedMatch = pathname.match(/^\/api\/saved-jobs(?:\/([\w-]+))?$/);
  if (savedMatch && method === 'GET') { const user = requireUser(req, res, 'Candidate'); if (!user) return; const ids = new Set(store.savedJobs.filter(item => item.candidateId === user.id).map(item => item.jobId)); return send(res, 200, { jobs: store.jobs.filter(job => ids.has(job.id)) }); }
  if (savedMatch && method === 'POST') { const user = requireUser(req, res, 'Candidate'); if (!user) return; const job = appJob(savedMatch[1]); if (!job) return fail(res, 404, 'Job not found.'); if (!store.savedJobs.some(item => item.candidateId === user.id && item.jobId === job.id)) store.savedJobs.push({ candidateId: user.id, jobId: job.id, createdAt: new Date().toISOString() }); writeStore(); return send(res, 201, { saved: true }); }
  if (savedMatch && method === 'DELETE') { const user = requireUser(req, res, 'Candidate'); if (!user) return; store.savedJobs = store.savedJobs.filter(item => !(item.candidateId === user.id && item.jobId === savedMatch[1])); writeStore(); return send(res, 200, { saved: false }); }
  if (method === 'GET' && pathname === '/api/applications/mine') {
    const user = requireUser(req, res); if (!user) return;
    const applications = user.role === 'Candidate' ? store.applications.filter(a => a.candidateId === user.id) : store.applications.filter(a => appJob(a.jobId)?.ownerId === user.id);
    return send(res, 200, { applications: applications.map(a => ({ ...a, job: appJob(a.jobId), candidate: user.role === 'Recruiter' ? publicUser(store.users.find(u => u.id === a.candidateId)) : undefined })) });
  }
  const statusMatch = pathname.match(/^\/api\/applications\/([\w-]+)$/);
  if (method === 'PATCH' && statusMatch) {
    const user = requireUser(req, res, 'Recruiter'); if (!user) return; const application = store.applications.find(a => a.id === statusMatch[1]); if (!application || appJob(application.jobId)?.ownerId !== user.id) return fail(res, 404, 'Application not found.');
    const body = await readBody(req); if (!['In review', 'Shortlisted', 'Rejected', 'Hired'].includes(body.status)) return fail(res, 400, 'Choose a valid application status.'); application.status = body.status; writeStore(); return send(res, 200, { application });
  }
  if (method === 'GET' && pathname === '/api/profile') { const user = requireUser(req, res); return user ? send(res, 200, { profile: publicUser(user) }) : undefined; }
  if (method === 'PATCH' && pathname === '/api/profile') {
    const user = requireUser(req, res); if (!user) return; const body = await readBody(req); for (const key of ['name', 'headline', 'location', 'summary', 'skills', 'company']) if (typeof body[key] === 'string') user[key] = cleanText(body[key], key === 'summary' ? 4000 : 300);
    writeStore(); return send(res, 200, { profile: publicUser(user) });
  }
  if (method === 'GET' && pathname === '/api/dashboard/candidate') {
    const user = requireUser(req, res, 'Candidate'); if (!user) return; const applications = store.applications.filter(a => a.candidateId === user.id).map(a => ({ ...a, job: appJob(a.jobId) })); const profileFields = ['headline', 'location', 'summary', 'skills']; const complete = profileFields.filter(key => user[key]).length;
    return send(res, 200, { user: publicUser(user), applications, profileCompleteness: Math.round((complete / profileFields.length) * 100) });
  }
  if (method === 'GET' && pathname === '/api/dashboard/recruiter') {
    const user = requireUser(req, res, 'Recruiter'); if (!user) return; const jobs = store.jobs.filter(job => job.ownerId === user.id); const applications = store.applications.filter(a => jobs.some(job => job.id === a.jobId)).map(a => ({ ...a, job: appJob(a.jobId), candidate: publicUser(store.users.find(u => u.id === a.candidateId)) })); return send(res, 200, { user: publicUser(user), jobs, applications });
  }
  return fail(res, 404, 'API route not found.');
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) { if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return fail(res, 405, 'Method not allowed.'); return await handleApi(req, res, url); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed.'); return serveStatic(req, res, url.pathname);
  } catch (error) { console.error(error); if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : 'Something went wrong.'); else res.destroy(); }
});
server.listen(PORT, () => console.log(`HireAI is ready at http://localhost:${PORT}`));
