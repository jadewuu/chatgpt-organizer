function normalizeApiConversation(item) {
  if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.id)) return null;
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

module.exports = { normalizeApiConversation, mergeConversations };
