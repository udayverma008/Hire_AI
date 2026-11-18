# HireAI backend

## Run locally

From the repository root, run the following with Node.js 20 or newer.

```sh
cd server
npm ci
npm start
```

Visit http://localhost:3000 for the same-origin frontend and API. Set `PORT` to use a different port. `GET /api/health` returns `{"ok":true,"service":"HireAI API"}`.

Run `npm test` from `server`. The integration tests start a copy of the backend on an ephemeral port and use isolated temporary data. They exercise the existing API and frontend entry points without opening the checkout's data file.

## Existing API contract

For routes that take a request body, send a JSON object. API errors use `{"error":"message"}`. Registration and login issue a `hireai_session` cookie. Send it on signed-in requests. The browser does this automatically for same-origin calls.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | Public | API health |
| POST | `/api/auth/register` | Public | Register a Candidate or Recruiter and start a session |
| POST | `/api/auth/login` | Public | Start a session with email and password |
| POST | `/api/auth/logout` | Any | End the current session and clear the cookie |
| GET | `/api/auth/me` | Signed in | Return the current user |
| GET | `/api/jobs` | Public | List jobs with optional `keyword`, `location`, `type`, `category`, and `sort=newest` |
| GET | `/api/jobs/:id` | Public | Get job details |
| POST | `/api/jobs` | Recruiter | Create a job |
| POST | `/api/jobs/:id/applications` | Candidate | Apply with an optional `coverNote` |
| GET | `/api/applications/mine` | Signed in | List applications visible to the current user |
| PATCH | `/api/applications/:id` | Owning recruiter | Set application `status` |
| GET | `/api/dashboard/candidate` | Candidate | Get applications and profile completeness |
| GET | `/api/dashboard/recruiter` | Recruiter | Get owned jobs and their applications |
| GET, PATCH | `/api/profile` | Signed in | Read or update the current profile |
| GET | `/api/saved-jobs` | Candidate | List saved jobs |
| POST, DELETE | `/api/saved-jobs/:id` | Candidate | Save or unsave a job |

## Hosted API

Set the following variables in your Node hosting service.

| Variable | Configuration |
| --- | --- |
| `NODE_ENV` | Set to `production` for HTTPS session cookies and required MongoDB configuration. |
| `MONGODB_URI` | Atlas connection string with the target database name. Store it as a secret. Give the API service's database account access to this database and allow the service's outbound network in Atlas. |
| `PORT` | Use the hosting service's assigned port. Defaults to 3000 locally. |
| `TRUST_PROXY_HOPS` | Set to the number of trusted proxy hops between the client and Express when this path is fixed and the service cannot be reached directly. |
| `FRONTEND_ORIGIN` | For split hosting, set the exact HTTPS frontend origin with no trailing slash. |
| `SEED_DEMO_JOBS` | Optional. Set to `true` for a demo database to insert the sample jobs by stable ID. |

From the repository root, build with `npm --prefix server ci` and start with `npm --prefix server start`. Configure the host's health check to use `GET /api/health`. The server waits for the MongoDB connection and indexes before accepting requests.

For split hosting, set `apiBaseUrl` in `client/assets/js/config.js` to the API's HTTPS origin. Use custom subdomains of the same site for cookie authentication, such as `app.example.com` and `api.example.com`. A frontend on a default `github.io` address and an API on an unrelated host are cross-site, so this setup's SameSite=Lax cookie will not be sent with cross-site fetches.

With no MongoDB URI, local development uses `data/hireai.json`. The hosted database starts independently of that file. MongoDB enforces unique email addresses and one application or saved-job record per candidate/job pair. It stores hashed session tokens and uses a TTL index for expired sessions. Configure Atlas backups for the live database and test restoring them before accepting real candidate data.

The current API covers the existing frontend contract. Company and resume records, job editing and closing, notifications, verification and recovery, and AI integrations are later work in the handoff. The status update API accepts `In review`, `Shortlisted`, `Rejected`, and `Hired`.
