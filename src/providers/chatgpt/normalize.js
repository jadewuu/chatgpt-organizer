function normalizeTimestamp(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : undefined;
}

function normalizeApiConversation(item) {
  if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.id)) return null;
  if (item.title != null && typeof item.title !== "string") return null;
  const createdAt = normalizeTimestamp(item.create_time);
  const updatedAt = normalizeTimestamp(item.update_time);
  if (createdAt === undefined || updatedAt === undefined) return null;
  if (item.gizmo_id != null && typeof item.gizmo_id !== "string") return null;
  return {
    provider: "chatgpt",
    conversationId: item.id,
    title: item.title || "(无标题)",
    createdAt,
    updatedAt,
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
