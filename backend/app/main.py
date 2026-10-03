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

class CombineContexts(BaseModel):
    context_ids: list[str]
    name: str

@app.post("/contexts/combine")
def combine_contexts(payload: CombineContexts):
    # Create a new combined context
    colors = ["#a855f7"]  # purple, to visually signal "combined"
    new_context = supabase.table("contexts").insert({
        "workspace_id": DEFAULT_WORKSPACE_ID,
        "name": payload.name,
        "color": colors[0],
        "type": "combined",
        "source_context_ids": payload.context_ids,
    }).execute().data[0]

    # Pull all source contexts' names + histories, build a summary intro message
    summary_parts = []
    for cid in payload.context_ids:
        ctx = supabase.table("contexts").select("*").eq("id", cid).execute().data[0]
        msgs = supabase.table("messages").select("*").eq("context_id", cid).order("created_at").execute().data
        convo_text = "\n".join(f"{m['role']}: {m['content']}" for m in msgs)
        summary_parts.append(f"--- Conversation in '{ctx['name']}' ---\n{convo_text}")

    combined_summary = "\n\n".join(summary_parts)

    # Store this as a system-style first message in the new combined context
    intro = f"You now have access to the following separate conversations. Use them to answer questions that compare or combine them.\n\n{combined_summary}"
    supabase.table("messages").insert({
        "context_id": new_context["id"],
        "role": "user",
        "content": intro,
    }).execute()

    # Get an initial AI response acknowledging the combination
    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": intro}],
    )
    reply_text = response.choices[0].message.content
    supabase.table("messages").insert({
        "context_id": new_context["id"],
        "role": "assistant",
        "content": reply_text,
    }).execute()

    return new_context