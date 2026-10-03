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
    result = (
        supabase.table("messages")
        .select("*")
        .eq("context_id", context_id)
        .eq("visible", True)
        .order("created_at")
        .execute()
    )
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

    # Store this as a hidden system-style first message in the new combined context
    intro = f"You now have access to the following separate conversations. Use them to answer questions that compare or combine them.\n\n{combined_summary}"
    supabase.table("messages").insert({
        "context_id": new_context["id"],
        "role": "user",
        "content": intro,
        "visible": False,  # Hide the raw context dump from the UI display
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

import json

class CreateTask(BaseModel):
    objective: str

@app.post("/primary-task")
def create_primary_task(payload: CreateTask):
    # Ask the LLM to break the objective into a short ordered plan
    plan_prompt = (
        f"Break this goal into 4 to 6 short ordered steps: '{payload.objective}'. "
        "Respond with ONLY a JSON array of short step names, like "
        '["Step one", "Step two", "Step three"]. No other text.'
    )
    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": plan_prompt}],
    )
    raw = response.choices[0].message.content.strip()

    # Be forgiving if the model wraps it in ```json ... ```
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.replace("json", "", 1).strip()

    try:
        plan = json.loads(raw)
    except Exception:
        plan = [raw]  # fallback: treat whole thing as one step

    task_state = {
        "plan": plan,
        "completed": [],
        "current": plan[0] if plan else None,
        "remaining": plan[1:] if len(plan) > 1 else [],
        "log": [],
    }

    result = supabase.table("primary_tasks").insert({
        "workspace_id": DEFAULT_WORKSPACE_ID,
        "objective": payload.objective,
        "task_state": task_state,
    }).execute()

    return result.data[0]

@app.get("/primary-task")
def get_primary_task():
    result = (
        supabase.table("primary_tasks")
        .select("*")
        .eq("workspace_id", DEFAULT_WORKSPACE_ID)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None

@app.post("/primary-task/{task_id}/continue")
def continue_primary_task(task_id: str):
    task = supabase.table("primary_tasks").select("*").eq("id", task_id).execute().data[0]
    state = task["task_state"]

    if not state["current"]:
        return task  # nothing left to do

    continue_prompt = (
        f"Objective: {task['objective']}\n"
        f"Already completed steps: {state['completed']}\n"
        f"Now working on: '{state['current']}'.\n"
        "Write 2-3 sentences describing the outcome of completing this step, "
        "as if you just did it."
    )
    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": continue_prompt}],
    )
    step_result = response.choices[0].message.content.strip()

    # Advance the plan
    state["log"].append({"step": state["current"], "result": step_result})
    state["completed"].append(state["current"])
    if state["remaining"]:
        state["current"] = state["remaining"][0]
        state["remaining"] = state["remaining"][1:]
    else:
        state["current"] = None

    result = (
        supabase.table("primary_tasks")
        .update({"task_state": state})
        .eq("id", task_id)
        .execute()
    )
    return result.data[0]

@app.delete("/contexts/{context_id}")
def delete_context(context_id: str):
    supabase.table("messages").delete().eq("context_id", context_id).execute()
    supabase.table("contexts").delete().eq("id", context_id).execute()
    return {"deleted": context_id}

class CreateAnnotation(BaseModel):
    source_type: str
    source_id: str
    selected_text: str

class AnnotationMessage(BaseModel):
    content: str

@app.post("/annotations")
def create_annotation(payload: CreateAnnotation):
    result = supabase.table("annotations").insert({
        "workspace_id": DEFAULT_WORKSPACE_ID,
        "source_type": payload.source_type,
        "source_id": payload.source_id,
        "selected_text": payload.selected_text,
    }).execute()
    return result.data[0]

@app.get("/annotations/{annotation_id}/messages")
def get_annotation_messages(annotation_id: str):
    result = (
        supabase.table("annotation_messages")
        .select("*")
        .eq("annotation_id", annotation_id)
        .order("created_at")
        .execute()
    )
    return result.data

@app.post("/annotations/{annotation_id}/messages")
def send_annotation_message(annotation_id: str, payload: AnnotationMessage):
    annotation = supabase.table("annotations").select("*").eq("id", annotation_id).execute().data[0]
    history = (
        supabase.table("annotation_messages")
        .select("*")
        .eq("annotation_id", annotation_id)
        .order("created_at")
        .execute()
        .data
    )

    supabase.table("annotation_messages").insert({
        "annotation_id": annotation_id,
        "role": "user",
        "content": payload.content,
    }).execute()

    llm_messages = [
        {"role": "system", "content": f"The user highlighted this text: \"{annotation['selected_text']}\". Answer questions about it."},
    ] + [{"role": m["role"], "content": m["content"]} for m in history] + [
        {"role": "user", "content": payload.content}
    ]

    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=llm_messages,
    )
    reply_text = response.choices[0].message.content

    result = supabase.table("annotation_messages").insert({
        "annotation_id": annotation_id,
        "role": "assistant",
        "content": reply_text,
    }).execute()

    return result.data[0]