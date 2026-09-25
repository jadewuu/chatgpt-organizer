function normalizeApiConversation(item) {
  if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.id)) return null;
  if (item.title != null && typeof item.title !== "string") return null;
  if ([item.create_time, item.update_time].some((value) => value != null && (typeof value !== "number" || !Number.isFinite(value)))) return null;
  if (item.gizmo_id != null && typeof item.gizmo_id !== "string") return null;
  return {
    provider: "chatgpt",
    conversationId: item.id,
    title: item.title || "(无标题)",
    createdAt: item.create_time ?? null,
    updatedAt: item.update_time ?? null,
    currentProject: item.gizmo_id ?? null,
    url: `https://chatgpt.com/c/${item.id}`,
  };
}

function mergeConversations(items) {
  const conversations = new Map();
  for (const item of items) {
    if (!item) continue;
    const key = JSON.stringify([item.provider, item.conversationId]);
    const previous = conversations.get(key);
    if (!previous || (item.updatedAt ?? 0) >= (previous.updatedAt ?? 0)) conversations.set(key, item);
  }
  return [...conversations.values()];
}

function isCompleteConversationRecord(record, id) {
  if (!record || record.provider !== "chatgpt" || record.conversationId !== id
    || typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)
    || typeof record.url !== "string" || !Array.isArray(record.messages) || record.messages.length === 0
    || record.extractionEvidence?.fullIdResponse !== true || record.extractionEvidence?.stableRender !== true
    || record.extractionEvidence?.complete !== true) return false;
  let url;
  try { url = new URL(record.url); } catch { return false; }
  return url.origin === "https://chatgpt.com" && url.pathname === `/c/${id}`
    && record.messages.every((message) => message && ["user", "assistant", "system", "developer", "tool"].includes(message.role)
      && typeof message.text === "string" && message.text.trim().length > 0);
}

function detailMessages(data, id) {
  if (data?.conversation_id !== id || !data.mapping || typeof data.current_node !== "string") return null;
  const messages = [];
  const visited = new Set();
  let nodeId = data.current_node;
  while (nodeId !== null) {
    if (typeof nodeId !== "string" || visited.has(nodeId)) return null;
    visited.add(nodeId);
    const node = data.mapping[nodeId];
    if (!node) return null;
    const message = node.message;
    if (message && ["user", "assistant"].includes(message.author?.role)) {
      if (message.status !== "finished_successfully"
        || (message.author.role === "assistant" && message.end_turn !== true)) return null;
      if (message.content?.content_type !== "text" || !Array.isArray(message.content.parts)
        || !message.content.parts.every((part) => typeof part === "string")) return null;
      const text = message.content.parts.join("").trim();
      if (!text) return null;
      messages.unshift({ role: message.author.role, text });
    } else if (message && !["system", "developer"].includes(message.author?.role)) return null;
    nodeId = node.parent;
  }
  return messages.length ? messages : null;
}

module.exports = { normalizeApiConversation, mergeConversations, isCompleteConversationRecord, detailMessages };
