import os
from dotenv import load_dotenv
from supabase import create_client
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DEFAULT_WORKSPACE_ID = os.getenv("DEFAULT_WORKSPACE_ID")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()

# Allow the Next.js frontend (localhost:3000) to call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/workspace")
def get_workspace():
    result = supabase.table("workspaces").select("*").eq("id", DEFAULT_WORKSPACE_ID).execute()
    return result.data


# ---- Contexts ----

class CreateContext(BaseModel):
    name: str
    color: str

@app.get("/contexts")
def list_contexts():
    result = supabase.table("contexts").select("*").eq("workspace_id", DEFAULT_WORKSPACE_ID).execute()
    return result.data

@app.post("/contexts")
def create_context(payload: CreateContext):
    result = supabase.table("contexts").insert({
        "workspace_id": DEFAULT_WORKSPACE_ID,
        "name": payload.name,
        "color": payload.color,
        "type": "normal",
    }).execute()
    return result.data[0]


# ---- Messages ----

class SendMessage(BaseModel):
    content: str

@app.get("/contexts/{context_id}/messages")
def get_messages(context_id: str):
    result = supabase.table("messages").select("*").eq("context_id", context_id).order("created_at").execute()
    return result.data

@app.post("/contexts/{context_id}/messages")
def send_message(context_id: str, payload: SendMessage):
    # Save the user's message
    supabase.table("messages").insert({
        "context_id": context_id,
        "role": "user",
        "content": payload.content,
    }).execute()

    # Fake AI reply for now — real LLM comes in the next step
    fake_reply = f"(fake reply) You said: {payload.content}"
    result = supabase.table("messages").insert({
        "context_id": context_id,
        "role": "assistant",
        "content": fake_reply,
    }).execute()

    return result.data[0]