# HireAI

HireAI is a recruitment and career platform prototype with a vanilla HTML/CSS/JavaScript frontend and a Node.js API. No third-party packages are required.

## Run it locally

1. Install Node.js 20 or newer.
2. Open a terminal in the project folder.
3. Run `cd server` and then `npm start`.
4. Open `http://localhost:3000`.

The first start creates `server/data/hireai.json` with sample job listings. New accounts, profiles, recruiter job posts, applications, and saved roles are stored there. That local database is ignored by Git. Use a candidate account to apply for jobs, or select Recruiter during sign-up to post roles and manage applications.

## Current limits

- This is suitable for local development and demonstration. The JSON file and in-memory sessions are not a production database/session store.
- Email delivery and password reset need an email provider.
- AI career suggestions are illustrative; a real AI provider requires a server-side API key.
- To make the backend available publicly, deploy the Node server and its persistent storage over HTTPS. GitHub Pages alone can serve the static frontend but cannot run this API.

The resume builder supports local draft saving, font and color choices, optional photo, editable sections, and print-to-PDF.
