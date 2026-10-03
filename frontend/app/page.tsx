"use client";

import { useEffect, useState, useRef } from "react";

type ChatContext = { id: string; name: string; color: string };
type Message = { id: string; context_id: string; role: "user" | "assistant"; content: string };
type TaskState = {
  plan: string[];
  completed: string[];
  current: string | null;
  remaining: string[];
  log: { step: string; result: string }[];
};
type PrimaryTask = { id: string; objective: string; task_state: TaskState };
type AnnotationMsg = { id: string; role: "user" | "assistant"; content: string };

const COLORS = ["#22c55e", "#ef4444", "#3b82f6", "#eab308", "#a855f7", "#ec4899"];
const API = "http://localhost:8000";

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedForCombine, setSelectedForCombine] = useState<string[]>([]);
  const [combineMode, setCombineMode] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [task, setTask] = useState<PrimaryTask | null>(null);

  const [annotation, setAnnotation] = useState<{ id: string; selectedText: string } | null>(null);
  const [annotationMessages, setAnnotationMessages] = useState<AnnotationMsg[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const taskPanelRef = useRef<HTMLDivElement>(null);

  const isDark = theme === "dark";

  function handleMouseMove(e: React.MouseEvent) {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    setMousePos({ x, y });
  }

  // --- Load contexts once ---
  useEffect(() => {
    fetch(`${API}/contexts`)
      .then((r) => r.json())
      .then((data: ChatContext[]) => {
        setContexts(data);
        if (data.length > 0) setActiveContextId(data[0].id);
      });
  }, []);

  // --- Load messages for ONLY the active context ---
  useEffect(() => {
    if (!activeContextId) {
      setMessages([]);
      return;
    }
    fetch(`${API}/contexts/${activeContextId}/messages`)
      .then((r) => r.json())
      .then(setMessages);
  }, [activeContextId]);

  // --- Auto-scroll chat to bottom ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // --- Load primary task ---
  useEffect(() => {
    fetch(`${API}/primary-task`)
      .then((r) => r.json())
      .then((data) => setTask(data));
  }, []);

  // --- Context actions ---
  async function addContext() {
    const name = prompt("Name this context:");
    if (!name) return;
    const color = COLORS[contexts.length % COLORS.length];
    const res = await fetch(`${API}/contexts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    const newContext = await res.json();
    setContexts([...contexts, newContext]);
    setActiveContextId(newContext.id);
  }

  async function deleteContext(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this context and all its messages?")) return;
    await fetch(`${API}/contexts/${id}`, { method: "DELETE" });
    const remaining = contexts.filter((c) => c.id !== id);
    setContexts(remaining);
    if (activeContextId === id) {
      setActiveContextId(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  async function sendMessage() {
    if (!draft.trim() || !activeContextId) return;
    const content = draft;
    setDraft("");
    await fetch(`${API}/contexts/${activeContextId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const updated = await fetch(`${API}/contexts/${activeContextId}/messages`).then((r) => r.json());
    setMessages(updated);
  }

  async function combineSelected() {
    if (selectedForCombine.length < 2) {
      alert("Select at least 2 contexts to combine.");
      return;
    }
    const name = prompt("Name this combined context:", "Combined");
    if (!name) return;
    const res = await fetch(`${API}/contexts/combine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_ids: selectedForCombine, name }),
    });
    const newContext = await res.json();
    setContexts([...contexts, newContext]);
    setActiveContextId(newContext.id);
    setCombineMode(false);
    setSelectedForCombine([]);
  }

  function toggleSelectForCombine(id: string) {
    setSelectedForCombine((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function colorFor(contextId: string) {
    return contexts.find((c) => c.id === contextId)?.color ?? "#999";
  }
  function nameFor(contextId: string) {
    return contexts.find((c) => c.id === contextId)?.name ?? "Unknown";
  }

  // --- Primary Task actions ---
  async function startTask() {
    const objective = prompt("What's the goal? (e.g. 'Build a wooden boat')");
    if (!objective) return;
    const res = await fetch(`${API}/primary-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective }),
    });
    setTask(await res.json());
  }

  async function continueTask() {
    if (!task) return;
    const res = await fetch(`${API}/primary-task/${task.id}/continue`, { method: "POST" });
    setTask(await res.json());
  }

  // --- Highlight & Ask ---
  function handleTaskSelection() {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length > 2 && task) {
      startAnnotation(text, task.id);
    }
  }

  async function startAnnotation(selectedText: string, sourceId: string) {
    const res = await fetch(`${API}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "primary_task", source_id: sourceId, selected_text: selectedText }),
    });
    const newAnnotation = await res.json();
    setAnnotation({ id: newAnnotation.id, selectedText });
    setAnnotationMessages([]);
  }

  async function sendAnnotationMessage() {
    if (!annotationDraft.trim() || !annotation) return;
    const content = annotationDraft;
    setAnnotationDraft("");
    await fetch(`${API}/annotations/${annotation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const updated = await fetch(`${API}/annotations/${annotation.id}/messages`).then((r) => r.json());
    setAnnotationMessages(updated);
  }

  function closeAnnotation() {
    setAnnotation(null);
    setAnnotationMessages([]);
  }

  const bg = isDark
    ? `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, rgba(99,102,241,0.15), transparent 40%), #0a0a0f`
    : `radial-gradient(600px circle at ${mousePos.x}% ${mousePos.y}%, rgba(99,102,241,0.08), transparent 40%), #f8f9fb`;

  const textMain = isDark ? "text-gray-100" : "text-gray-900";
  const cardBg = isDark ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200";
  const subText = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div onMouseMove={handleMouseMove} style={{ background: bg, minHeight: "100vh", transition: "background 0.1s" }} className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className={`text-2xl font-bold ${textMain}`}>ContextFlow</h1>
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={`px-3 py-1.5 rounded-full border text-sm ${isDark ? "border-gray-700 text-gray-200" : "border-gray-300 text-gray-700"}`}
        >
          {isDark ? "☀ Light" : "🌙 Dark"}
        </button>
      </div>

      {/* Context navbar — collapsible */}
      <div className="relative mb-4 inline-block">
        <button
          onClick={() => setContextMenuOpen(!contextMenuOpen)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm ${isDark ? "border-gray-700 text-gray-200 bg-gray-900" : "border-gray-300 text-gray-700 bg-white"}`}
        >
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: activeContextId ? colorFor(activeContextId) : "#999" }} />
          {activeContextId ? nameFor(activeContextId) : "Contexts"}
          <span>{contextMenuOpen ? "▲" : "▼"}</span>
        </button>

        {contextMenuOpen && (
          <div className={`absolute z-10 mt-2 p-3 rounded-lg border shadow-lg min-w-[240px] ${cardBg}`}>
            <div className="flex flex-col gap-1 mb-2">
              {contexts.map((ctx) => (
                <div
                  key={ctx.id}
                  onClick={() =>
                    combineMode
                      ? toggleSelectForCombine(ctx.id)
                      : (setActiveContextId(ctx.id), setContextMenuOpen(false))
                  }
                  className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer text-sm
                    ${isDark ? "hover:bg-gray-800" : "hover:bg-gray-100"}
                    ${combineMode && selectedForCombine.includes(ctx.id) ? "ring-2 ring-purple-500" : ""}
                    ${ctx.id === activeContextId && !combineMode ? "font-semibold" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: ctx.color }} />
                    <span className={textMain}>{ctx.name}</span>
                  </span>
                  {!combineMode && (
                    <button onClick={(e) => deleteContext(ctx.id, e)} className="text-gray-400 hover:text-red-500 text-xs">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className={`flex flex-col gap-1 pt-2 border-t ${isDark ? "border-gray-800" : "border-gray-200"}`}>
              <button onClick={addContext} className={`text-sm text-left px-2 py-1 rounded ${isDark ? "hover:bg-gray-800 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}>
                + New Context
              </button>
              <button
                onClick={() => setCombineMode(!combineMode)}
                className="text-sm text-left px-2 py-1 rounded text-purple-500 hover:bg-purple-500/10"
              >
                {combineMode ? "Cancel combine" : "⇄ Combine contexts"}
              </button>
              {combineMode && (
                <button onClick={combineSelected} className="text-sm text-left px-2 py-1 rounded bg-purple-600 text-white">
                  Combine Selected ({selectedForCombine.length})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main grid */}
      <div className={`grid gap-6 ${annotation ? "lg:grid-cols-3" : "lg:grid-cols-2"} grid-cols-1`}>
        {/* Chat column */}
        <div>
          <div
            className={`border rounded-lg p-4 h-[420px] overflow-y-auto mb-4 shadow-sm ${cardBg}`}
            style={{ scrollbarWidth: "thin", scrollbarColor: isDark ? "#444 transparent" : "#ccc transparent" }}
          >
            {messages.length === 0 && <p className={`text-sm ${subText}`}>No messages yet.</p>}
            {messages.map((m) => (
              <div key={m.id} className="mb-3 text-sm leading-relaxed">
                <span className="font-semibold" style={{ color: activeContextId ? colorFor(activeContextId) : "#999" }}>
                  {m.role === "user" ? "You" : "AI"}:
                </span>{" "}
                <span className={textMain}>{m.content}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={activeContextId ? `Message ${nameFor(activeContextId)}...` : "Create a context first"}
              disabled={!activeContextId}
              className={`flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40 ${isDark ? "bg-gray-900 border-gray-700 text-gray-100" : "bg-white border-gray-300"}`}
            />
            <button onClick={sendMessage} className="px-4 py-2 rounded-md bg-black text-white text-sm hover:bg-gray-800">
              Send
            </button>
          </div>
        </div>

        {/* Primary Task column */}
        <div ref={taskPanelRef} onMouseUp={handleTaskSelection} className={`border rounded-lg p-4 shadow-sm h-fit ${cardBg}`}>
          {!task ? (
            <button onClick={startTask} className="px-4 py-2 rounded-md bg-amber-500 text-white text-sm hover:bg-amber-600 w-full">
              🚤 Start a Primary Task
            </button>
          ) : (
            <div>
              <strong className={textMain}>🚤 {task.objective}</strong>
              <ul className="mt-2 space-y-1 text-sm">
                {task.task_state.completed.map((step, i) => (
                  <li key={i} className="text-green-500">✓ {step}</li>
                ))}
                {task.task_state.current && <li className={`font-semibold ${textMain}`}>▶ {task.task_state.current}</li>}
                {task.task_state.remaining.map((step, i) => (
                  <li key={i} className={subText}>○ {step}</li>
                ))}
              </ul>
              {task.task_state.current ? (
                <button onClick={continueTask} className="mt-3 px-3 py-1.5 rounded-md bg-amber-500 text-white text-sm hover:bg-amber-600">
                  Continue
                </button>
              ) : (
                <p className="mt-3 text-green-500 text-sm">✓ Task complete!</p>
              )}
              {task.task_state.log.length > 0 && (
                <div className={`mt-4 text-xs space-y-2 ${subText}`}>
                  <strong className={`block ${isDark ? "text-gray-300" : "text-gray-700"}`}>Log (select text to ask about it):</strong>
                  {task.task_state.log.map((entry, i) => (
                    <p key={i}>
                      <em className={isDark ? "text-gray-300" : "text-gray-600"}>{entry.step}:</em> {entry.result}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Highlight & Ask column */}
        {annotation && (
          <div className={`border rounded-lg p-4 shadow-sm flex flex-col ${cardBg}`}>
            <div className="flex items-center justify-between mb-2">
              <strong className={textMain}>🔍 Highlight & Ask</strong>
              <button onClick={closeAnnotation} className="text-gray-400 hover:text-red-500 text-sm">✕</button>
            </div>
            <p className={`text-xs italic mb-3 p-2 rounded ${isDark ? "bg-gray-800 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
              "{annotation.selectedText}"
            </p>
            <div className="flex-1 mb-3 space-y-2 text-sm max-h-[300px] overflow-y-auto">
              {annotationMessages.map((m) => (
                <p key={m.id}>
                  <span className="font-semibold">{m.role === "user" ? "You" : "AI"}:</span>{" "}
                  <span className={textMain}>{m.content}</span>
                </p>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={annotationDraft}
                onChange={(e) => setAnnotationDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendAnnotationMessage()}
                placeholder="Ask about this..."
                className={`flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none ${isDark ? "bg-gray-900 border-gray-700 text-gray-100" : "bg-white border-gray-300"}`}
              />
              <button onClick={sendAnnotationMessage} className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700">
                Ask
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}