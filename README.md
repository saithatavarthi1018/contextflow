[README.md](https://github.com/user-attachments/files/33005564/README.md)
# ContextFlow

**A context-isolated LLM workspace.** Most chat apps send a model's entire conversation history on every request. ContextFlow keeps multiple independent conversation threads ("contexts"), each with its own isolated history, and lets the application — not the model — decide exactly which context a request can see.

Built as a BTech full-stack project to demonstrate context isolation, controlled context composition, and persistent multi-step task execution with an LLM.

---

## The core idea

```
USER
  │
  ▼
NEXT.JS FRONTEND
  │
  ▼
FASTAPI BACKEND
  │
  ▼
CONTEXT ROUTER  ← loads ONLY the relevant context's messages
  │
  ▼
LLM (Groq / OpenAI-compatible)
  │
  ▼
SUPABASE (Postgres) ← persists contexts, messages, task state
```

The LLM is never responsible for deciding what it should or shouldn't know. The backend decides, by only loading the message history that belongs to the active context before calling the model.

---

## Features

### 1. Isolated Contexts
Create any number of named, colored conversation threads. Each one has its own message history in the database, and the backend only ever loads one context's messages when building a request to the LLM. Verified with a direct test: telling one context your name and asking a different context for it correctly returns "I don't know."

### 2. Combine Contexts
Select two or more existing contexts and merge them into a new one. The new context's first message is a system-style summary of both source conversations, generated once at creation time. The original contexts are left completely untouched — combining is a one-time composition, not a live merge.

### 3. Primary Task
Give the system a goal (e.g. "Build a wooden boat"). The LLM breaks it into an ordered step plan. Each click of "Continue" advances one step, generates a short outcome for it, and logs it — independent of any conversation context, with state persisted across sessions.

### 4. Highlight & Ask
Select any text inside the Primary Task log and a separate "Highlight & Ask" panel opens — its own short-lived, independent thread scoped to just that selection, kept apart from the main contexts.

---

## Stack

| Part | Technology |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python) |
| Database | Supabase (Postgres) |
| LLM | Groq (OpenAI-compatible API), `openai/gpt-oss-20b` |
| Auth | None in this version (single demo workspace) |

---

## Database schema

- **workspaces** — one root workspace for the demo
- **contexts** — `id, workspace_id, name, color, type (normal/combined), source_context_ids`
- **messages** — `id, context_id, role, content, visible` (the `visible` flag hides internal system messages, e.g. the combine summary, from the UI while still letting the LLM use them)
- **primary_tasks** — `id, workspace_id, objective, task_state (jsonb: plan/completed/current/remaining/log)`
- **annotations** / **annotation_messages** — Highlight & Ask threads, scoped to a source and a selected text span

---

## Running locally

**Backend**
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install fastapi "uvicorn[standard]" openai supabase python-dotenv
uvicorn app.main:app --reload
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Create `backend/.env`:
```
SUPABASE_URL=...
SUPABASE_KEY=...
DEFAULT_WORKSPACE_ID=...
GROQ_API_KEY=...
```

Visit `http://localhost:3000`. Backend runs on `http://localhost:8000` (`/docs` for interactive API testing).

---

## What this deliberately leaves out (V1 scope)

Per the project plan, these were intentionally skipped to keep V1 focused and buildable:

- Authentication (single hardcoded demo workspace)
- Streaming responses
- Multi-agent orchestration, RAG, vector search
- Deployment (Vercel/Render) — run locally for demo
- Background task workers

These are natural "V2" extensions, not missing requirements.

---

## What I'd improve next

- Combined contexts currently snapshot their sources at creation time rather than staying live-linked to later messages in the originals
- LLM replies could be tuned for a more casual, concise chat tone (currently uses default formal style)
- Planned improvements focus on enabling real-time context synchronization and adjusting the LLM generation parameters to deliver a casual, instant-messaging response style.
