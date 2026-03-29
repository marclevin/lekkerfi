# LekkerFi

A financial care platform for South Africa — AI-powered, human-guided. LekkerFi wraps a trusted support network around users at the moment of financial decisions, in their own language.

---

## What it does

**For users:** Connect your ABSA account or upload a bank statement. Get a plain-language summary of your spending, then chat with an AI financial assistant in English, isiZulu, isiXhosa, Sesotho, or Afrikaans. When a high-risk spending decision is detected, the chat pauses and your supporter is looped in.

**For supporters (financial coaches, social workers, family):** A real-time care dashboard showing the people you support — their spending velocity, inactivity signals, and chat alerts. Triage by urgency (Act Now / Review / Logged), read the conversation that triggered an alert, approve or decline a spending decision, and send a message directly into a user's chat — translated to their language — without leaving the page.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, React Router |
| Backend | Python, Flask, Flask-JWT-Extended |
| Database | SQLAlchemy ORM — SQLite (dev), PostgreSQL (prod) |
| AI | OpenAI API |
| Banking | ABSA Playpen API (Open Finance) |
| Deployment | Render (backend + static frontend + managed Postgres) |

---

## Project structure

```
api/              Route handlers (auth, chat, insights, supporters, ABSA)
services/         Business logic (chat, alerts, statement processing, translation)
db/               SQLAlchemy models and database setup
frontend/         React + Vite SPA
  src/
    pages/        Route-level components (user + supporter views)
    components/   Shared UI components
    api/          API client
    utils/        Calm mode, helpers
OpenAPI_Specs/    ABSA Playpen API specs
tests/            pytest suite
```

---

## Getting started

### Prerequisites
- Python 3.11+
- Node.js 18+
- conda (recommended for env management)

### Backend

```bash
conda create -n isazi python=3.11
conda activate isazi
pip install -r requirements.txt
cp .env.example .env          # fill in your keys
python main.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` to `http://localhost:5000`.

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for chat and translation |
| `JWT_SECRET_KEY` | Secret for signing JWTs |
| `FLASK_SECRET_KEY` | Flask session secret |
| `DATABASE_URL` | SQLAlchemy database URL (defaults to SQLite) |
| `FRONTEND_ORIGIN` | CORS allowed origin |
| `playpen_key` / `playpen_secret` | ABSA Playpen API credentials |
| `GATEWAY_HOST` | ABSA API gateway host |

---

## Key features

- **Multilingual chat** — isiZulu, isiXhosa, Sesotho, Afrikaans, English
- **ABSA Open Finance integration** — live account data via consent flow
- **Bank statement OCR** — upload PDF or image, AI extracts and analyses transactions
- **Supporter alert triage** — priority lanes (Act Now / Review / Logged), SLA tracking, overdue flags
- **Chat pause mechanism** — high-risk intent pauses the chat and notifies the supporter
- **Inline supporter messaging** — send a message with one-tap translation preview, without leaving the alert
- **Calm Mode** — auto-activated on high-risk signals; reduces UI complexity to one action at a time
- **Spending limits** — supporters can set daily/weekly/monthly limits and balance thresholds
- **AI coaching copilot** — supporters can ask Claude for context-aware coaching suggestions based on the user's real data

---

## Deployment

Configured for [Render](https://render.com) via `render.yaml`. Push to `main` to auto-deploy.

- Backend: Python web service, Gunicorn, health check at `/api/health`
- Frontend: Static site, built with `npm run build`
- Database: Render managed PostgreSQL
