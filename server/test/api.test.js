'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const project = path.resolve(__dirname, '../..');

async function startFixture(t) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'hireai-test-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null && child.pid) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await fs.rm(fixture, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(fixture, 'server'));
  await fs.mkdir(path.join(fixture, 'client'));
  await Promise.all(['server/server.js', 'server/app.js', 'server/storage.js', 'index.html', 'client/index.html'].map(file =>
    fs.copyFile(path.join(project, file), path.join(fixture, file))
  ));
  child = spawn(process.execPath, [path.join(fixture, 'server', 'server.js')], {
    env: { ...process.env, PORT: '0', NODE_ENV: 'test', MONGODB_URI: '', FRONTEND_ORIGIN: 'https://app.example.test', NODE_PATH: path.join(project, 'server', 'node_modules') },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out starting HireAI.')), 5000);
    let output = '';
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`HireAI exited with ${code}. ${stderr}`));
    });
  });

  return (route, options) => fetch(`http://127.0.0.1:${port}${route}`, options);
}

async function json(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

function sessionCookie(response) {
  const header = response.headers.get('set-cookie');
  assert.match(header, /^hireai_session=/);
  assert.match(header, /HttpOnly; SameSite=Lax/);
  return header.split(';')[0];
}

function request(method, cookie, data) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (data !== undefined) headers['content-type'] = 'application/json';
  return { method, headers, body: data === undefined ? undefined : JSON.stringify(data) };
}

test('Express handles health, static files, methods, and routing errors', async t => {
  const fetch = await startFixture(t);
  const health = await fetch('/api/health');
  assert.deepEqual(await json(health, 200), { ok: true, service: 'HireAI API' });
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-powered-by'), null);

  for (const route of ['/', '/index.html', '/client/index.html']) {
    const page = await fetch(route);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /HireAI/i);
  }
  const head = await fetch('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.deepEqual(await json(await fetch('/api/unknown'), 404), { error: 'API route not found.' });
  assert.deepEqual(await json(await fetch('/server/server.js'), 404), { error: 'Page not found.' });
  const unsupported = await fetch('/api/health', { method: 'PUT' });
  assert.equal(unsupported.headers.get('allow'), 'GET, POST, PATCH, DELETE');
  assert.deepEqual(await json(unsupported, 405), { error: 'Method not allowed.' });
  assert.deepEqual(await json(await fetch('/', { method: 'POST' }), 405), { error: 'Method not allowed.' });
});

test('Express returns JSON for invalid and oversized request bodies', async t => {
  const fetch = await startFixture(t);
  const post = body => fetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body
  });
  assert.deepEqual(await json(await post('{'), 400), { error: 'Request body must be valid JSON.' });
  assert.deepEqual(await json(await post('[]'), 400), { error: 'Request body must be a JSON object.' });
  assert.deepEqual(await json(await post(JSON.stringify({ name: 'a'.repeat(1024 * 1024) })), 413),
    { error: 'Request body is too large.' });
  assert.equal((await fetch('/api/health')).status, 200);
});

test('only the configured frontend can make credentialed cross-origin API requests', async t => {
  const fetch = await startFixture(t);
  const origin = 'https://app.example.test';
  const preflight = await fetch('/api/auth/login', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const rejected = await fetch('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://other.example.test' } });
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  await json(rejected, 403);
});

test('existing frontend workflows work through Express', async t => {
  const fetch = await startFixture(t);
  const account = { name: 'Test Candidate', email: 'candidate@example.test', password: 'test-password', role: 'Candidate' };
  const call = async (route, status, method = 'GET', cookie, data) =>
    json(await fetch(route, request(method, cookie, data)), status);
  const register = data => fetch('/api/auth/register', request('POST', null, data));

  await call('/api/auth/me', 401);
  await call('/api/auth/register', 400, 'POST', null, { ...account, password: 'short' });
  const candidateSignup = await register(account);
  let candidate = sessionCookie(candidateSignup);
  const { user } = await json(candidateSignup, 200);
  assert.equal(user.role, 'Candidate');
  assert.equal('passwordHash' in user, false);
  assert.equal('passwordSalt' in user, false);
  await call('/api/auth/register', 409, 'POST', null, account);
  assert.equal((await call('/api/auth/me', 200, 'GET', candidate)).user.id, user.id);

  const recruiterSignup = await register({ ...account, name: 'Test Recruiter', email: 'recruiter@example.test', role: 'Recruiter' });
  const recruiter = sessionCookie(recruiterSignup);
  await json(recruiterSignup, 200);
  const jobData = { title: 'Test Engineer', company: 'Test Company', location: 'Remote', type: 'Full-time', category: 'Engineering', description: 'Build APIs.' };
  await call('/api/jobs', 403, 'POST', candidate, jobData);
  const { job } = await call('/api/jobs', 201, 'POST', recruiter, jobData);
  assert.equal((await call('/api/jobs?keyword=test%20engineer&location=remote', 200)).jobs[0].id, job.id);
  assert.equal((await call(`/api/jobs/${job.id}`, 200)).job.title, jobData.title);

  await call(`/api/saved-jobs/${job.id}`, 201, 'POST', candidate);
  assert.equal((await call('/api/saved-jobs', 200, 'GET', candidate)).jobs[0].id, job.id);
  await call(`/api/saved-jobs/${job.id}`, 200, 'DELETE', candidate);
  assert.deepEqual((await call('/api/saved-jobs', 200, 'GET', candidate)).jobs, []);

  const apply = () => fetch(`/api/jobs/${job.id}/applications`, request('POST', candidate, { coverNote: 'Interested.' }));
  const results = await Promise.all([apply(), apply()]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const { application } = await json(results.find(result => result.status === 201), 201);
  await call(`/api/applications/${application.id}`, 200, 'PATCH', recruiter, { status: 'In review' });
  assert.equal((await call('/api/applications/mine', 200, 'GET', candidate)).applications[0].status, 'In review');
  await call('/api/profile', 200, 'PATCH', candidate, { headline: 'Backend Engineer' });
  assert.equal((await call('/api/profile', 200, 'GET', candidate)).profile.headline, 'Backend Engineer');
  assert.equal((await call('/api/dashboard/candidate', 200, 'GET', candidate)).profileCompleteness, 25);
  assert.equal((await call('/api/dashboard/recruiter', 200, 'GET', recruiter)).applications[0].candidate.id, user.id);

  const logout = await fetch('/api/auth/logout', request('POST', candidate));
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  await json(logout, 200);
  await call('/api/auth/me', 401, 'GET', candidate);
  await call('/api/auth/login', 401, 'POST', null, { email: account.email, password: 'incorrect' });
  const login = await fetch('/api/auth/login', request('POST', null, { email: account.email, password: account.password }));
  candidate = sessionCookie(login);
  await json(login, 200);
  await call('/api/auth/me', 200, 'GET', candidate);
});
