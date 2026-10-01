"use client";

import { useState } from "react";

type ChatContext = {
  id: string;
  name: string;
  color: string;
};

type Message = {
  id: string;
  contextId: string;
  role: "user" | "assistant";
  content: string;
};

const COLORS = ["#22c55e", "#ef4444", "#3b82f6", "#eab308", "#a855f7", "#ec4899"];

export default function Home() {
  const [contexts, setContexts] = useState<ChatContext[]>([
    { id: "c1", name: "General", color: COLORS[0] },
  ]);
  const [activeContextId, setActiveContextId] = useState("c1");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  function addContext() {
    const name = prompt("Name this context:");
    if (!name) return;
    const color = COLORS[contexts.length % COLORS.length];
    const id = "c" + (contexts.length + 1) + "-" + Date.now();
    setContexts([...contexts, { id, name, color }]);
    setActiveContextId(id);
  }

  function sendMessage() {
    if (!draft.trim()) return;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      contextId: activeContextId,
      role: "user",
      content: draft,
    };
    const fakeReply: Message = {
      id: crypto.randomUUID(),
      contextId: activeContextId,
      role: "assistant",
      content: "(fake reply) You said: " + draft,
    };
    setMessages([...messages, userMsg, fakeReply]);
    setDraft("");
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

      {/* Context navbar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {contexts.map((ctx) => (
          <button
            key={ctx.id}
            onClick={() => setActiveContextId(ctx.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 20,
              border: ctx.id === activeContextId ? "2px solid black" : "1px solid #ccc",
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
      </div>

      {/* Unified timeline — shows ALL messages from ALL contexts */}
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, minHeight: 300, marginBottom: 16 }}>
        {messages.length === 0 && <p style={{ color: "#999" }}>No messages yet. Pick a context and say something.</p>}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: "bold", color: colorFor(m.contextId) }}>
              {nameFor(m.contextId)} · {m.role === "user" ? "You" : "AI"}:
            </span>{" "}
            {m.content}
          </div>
        ))}
      </div>

      {/* Input, sends to whichever context is active */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={`Message ${nameFor(activeContextId)}...`}
          style={{ flex: 1, padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
        />
        <button onClick={sendMessage} style={{ padding: "8px 16px", borderRadius: 6, background: "black", color: "white" }}>
          Send
        </button>
      </div>
    </div>
  );
}