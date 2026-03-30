# Chinwe — Clinical Assistant for Medical Students

A full-stack AI-powered clinical tool for medical students. Built with Node.js backend + plain HTML/JS frontend.

## Features
- H&X Coach — history questions and exam maneuvers by chief complaint
- DDx Generator — ranked differential with must-not-miss diagnoses
- Drug Dosing — evidence-based dosing with renal adjustments and interaction checks
- Clinical Guidelines — ACC/AHA, ADA, IDSA, and more
- H&P Note Writer — type or photo-to-note with supplemental verbal input
- Study Mode — Step 2 CK questions, including inline after note generation

---

## Project Structure
```
chinwe/
├── backend/        # Node.js Express API server
│   ├── server.js
│   ├── package.json
│   └── .env.example
└── frontend/       # Static HTML/CSS/JS app
    └── index.html
```

---

## Local Development

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm run dev
```
Backend runs on http://localhost:3001

### 2. Frontend
Open `frontend/index.html` in your browser directly, or serve it:
```bash
cd frontend
npx serve .
```

---

## Deploy

### Backend → Railway
1. Go to railway.app → New Project → Deploy from GitHub
2. Select the `chinwe` repo, set root directory to `backend`
3. Add environment variable: `ANTHROPIC_API_KEY=your_key_here`
4. Add `FRONTEND_URL=https://your-vercel-url.vercel.app`
5. Railway auto-deploys on every push to main

### Frontend → Vercel
1. Go to vercel.com → New Project → Import from GitHub
2. Select the `chinwe` repo, set root directory to `frontend`
3. No build command needed — it's static HTML
4. Deploy

### Connect Frontend to Backend
In `frontend/index.html`, update this line:
```js
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://your-railway-backend-url.railway.app';
```

---

## Environment Variables
| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `FRONTEND_URL` | Your Vercel frontend URL (for CORS) |
| `PORT` | Server port (default 3001) |
