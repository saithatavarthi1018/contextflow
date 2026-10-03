"use client";

import { useEffect, useState } from "react";

type ChatContext = {
  id: string;
  name: string;
  color: string;
};

type Message = {
  id: string;
  context_id: string;
  role: "user" | "assistant";
  content: string;
};

const COLORS = ["#22c55e", "#ef4444", "#3b82f6", "#eab308", "#a855f7", "#ec4899"];
const API = "http://localhost:8000";

export default function Home() {
  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedForCombine, setSelectedForCombine] = useState<string[]>([]);
  const [combineMode, setCombineMode] = useState(false);

  // Load contexts once on page load
  useEffect(() => {
    fetch(`${API}/contexts`)
      .then((r) => r.json())
      .then((data: ChatContext[]) => {
        setContexts(data);
        if (data.length > 0) setActiveContextId(data[0].id);
      });
  }, []);

  // Load messages for ALL contexts, so the unified timeline can show everything
  useEffect(() => {
    if (contexts.length === 0) return;
    Promise.all(
      contexts.map((c) =>
        fetch(`${API}/contexts/${c.id}/messages`).then((r) => r.json())
      )
    ).then((results) => {
      setMessages(results.flat());
    });
  }, [contexts]);

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

  async function sendMessage() {
    if (!draft.trim() || !activeContextId) return;
    const content = draft;
    setDraft("");
    await fetch(`${API}/contexts/${activeContextId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    // Refresh messages for this context from the server
    const updated = await fetch(`${API}/contexts/${activeContextId}/messages`).then((r) => r.json());
    setMessages([
      ...messages.filter((m) => m.context_id !== activeContextId),
      ...updated,
    ]);
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

    // Reload messages to include the new combined context's intro
    const updated = await fetch(`${API}/contexts/${newContext.id}/messages`).then((r) => r.json());
    setMessages([...messages, ...updated]);
  }

  function toggleSelectForCombine(id: string) {
    setSelectedForCombine((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function colorFor(contextId: string) {
    return contexts.find((c) => c.id === contextId)?.color ?? "#999";
  }

  function nameFor(contextId: string) {
    return contexts.find((c) => c.id === contextId)?.name ?? "Unknown";
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>ContextFlow</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {contexts.map((ctx) => (
          <button
            key={ctx.id}
            onClick={() =>
              combineMode ? toggleSelectForCombine(ctx.id) : setActiveContextId(ctx.id)
            }
            style={{
              padding: "6px 12px",
              borderRadius: 20,
              border: combineMode
                ? selectedForCombine.includes(ctx.id)
                  ? "2px solid purple"
                  : "1px solid #ccc"
                : ctx.id === activeContextId
                ? "2px solid black"
                : "1px solid #ccc",
              background: ctx.color + "22",
              cursor: "pointer",
            }}
          >
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: ctx.color, marginRight: 6 }} />
            {ctx.name}
          </button>
        ))}
        <button onClick={addContext} style={{ padding: "6px 12px", borderRadius: 20, border: "1px dashed #999" }}>
          + New Context
        </button>
        <button
          onClick={() => setCombineMode(!combineMode)}
          style={{ padding: "6px 12px", borderRadius: 20, border: "1px dashed purple", color: "purple" }}
        >
          {combineMode ? "Cancel" : "⇄ Combine"}
        </button>
        {combineMode && (
          <button
            onClick={combineSelected}
            style={{ padding: "6px 12px", borderRadius: 20, background: "purple", color: "white" }}
          >
            Combine Selected ({selectedForCombine.length})
          </button>
        )}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, minHeight: 300, marginBottom: 16 }}>
        {messages.length === 0 && <p style={{ color: "#999" }}>No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: "bold", color: colorFor(m.context_id) }}>
              {nameFor(m.context_id)} · {m.role === "user" ? "You" : "AI"}:
            </span>{" "}
            {m.content}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={activeContextId ? `Message ${nameFor(activeContextId)}...` : "Create a context first"}
          disabled={!activeContextId}
          style={{ flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
        />
        <button onClick={sendMessage} style={{ padding: "8px 16px", borderRadius: 6, background: "black", color: "white" }}>
          Send
        </button>
      </div>
    </div>
  );
}