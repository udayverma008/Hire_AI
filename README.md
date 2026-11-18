# HireAI

HireAI is a recruitment and career platform with a vanilla HTML/CSS/JavaScript frontend, an Express API, and a MongoDB storage adapter for hosted use.

## Run it locally

1. Install Node.js 20 or newer.
2. Open a terminal in the project folder.
3. Run `cd server`, then `npm ci` and `npm start`.
4. Open `http://localhost:3000`.

Local mode starts with sample job listings. The first write creates `server/data/hireai.json` for accounts, sessions, profiles, recruiter job posts, applications, and saved roles. That local database is ignored by Git. Use a candidate account to apply for jobs, or select Recruiter during sign-up to post roles and manage applications.

## Current limits

- Hosted production mode requires MongoDB. See the [backend setup](server/README.md#hosted-api) for environment variables and frontend connection settings.
- Email delivery and password reset need an email provider.
- AI career suggestions are illustrative; a real AI provider requires a server-side API key.
- To make the backend available publicly, deploy the Node server and its persistent storage over HTTPS. GitHub Pages alone can serve the static frontend but cannot run this API.

The resume builder supports local draft saving, font and color choices, optional photo, editable sections, and print-to-PDF.
