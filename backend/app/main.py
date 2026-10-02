import os
from dotenv import load_dotenv
from supabase import create_client
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DEFAULT_WORKSPACE_ID = os.getenv("DEFAULT_WORKSPACE_ID")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

groq_client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)

app = FastAPI()

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

    # Load ONLY this context's history — this is the core isolation logic
    history = supabase.table("messages").select("*").eq("context_id", context_id).order("created_at").execute().data

    llm_messages = [{"role": m["role"], "content": m["content"]} for m in history]

    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=llm_messages,
    )
    reply_text = response.choices[0].message.content

    result = supabase.table("messages").insert({
        "context_id": context_id,
        "role": "assistant",
        "content": reply_text,
    }).execute()

    return result.data[0]