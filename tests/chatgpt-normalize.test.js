const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("./fixtures/conversations.json");
const { normalizeApiConversation, mergeConversations, isCompleteConversationRecord, detailMessages } = require("../src/providers/chatgpt/normalize");

test("normalizes ChatGPT list items without message content", () => {
  assert.deepEqual(normalizeApiConversation({ ...fixtures[0], messages: ["synthetic secret"] }), {
    provider: "chatgpt",
    conversationId: "fixture-chat-1",
    title: "Synthetic planning chat",
    createdAt: 1700000000,
    updatedAt: 1700000100,
    currentProject: null,
    url: "https://chatgpt.com/c/fixture-chat-1",
  });
});

test("normalizes current ChatGPT ISO timestamps to Unix seconds", () => {
  assert.deepEqual(normalizeApiConversation({
    id: "fixture-chat-iso",
    title: "Synthetic ISO chat",
    create_time: "2026-09-26T08:30:00.250000+00:00",
    update_time: "2026-09-26T16:30:01+08:00",
  }), {
    provider: "chatgpt",
    conversationId: "fixture-chat-iso",
    title: "Synthetic ISO chat",
    createdAt: 1790411400.25,
    updatedAt: 1790411401,
    currentProject: null,
    url: "https://chatgpt.com/c/fixture-chat-iso",
  });
  assert.equal(normalizeApiConversation({ id: "fixture-chat", create_time: "not-a-timestamp" }), null);
  assert.equal(normalizeApiConversation({ id: "fixture-chat", create_time: "2026-02-30T00:00:00Z" }), null);
});

test("deduplicates by provider and full conversation ID, retaining the latest item", () => {
  const old = normalizeApiConversation({ id: "fixture-chat-1", title: "Old", update_time: 1 });
  const latest = normalizeApiConversation({ id: "fixture-chat-1", title: "New", update_time: 2 });
  const otherId = normalizeApiConversation({ id: "fixture-chat-1-longer", title: "Different ID" });
  const otherProvider = { ...old, provider: "fixture-provider", title: "Different provider" };
  assert.deepEqual(mergeConversations([latest, old, otherId, otherProvider]).map((c) => c.title),
    ["New", "Different ID", "Different provider"]);
});

test("normalization preserves project IDs and excludes entries without a usable full ID", () => {
  assert.equal(normalizeApiConversation(fixtures[1]).currentProject, "fixture-project");
  assert.equal(normalizeApiConversation({ title: "Missing ID" }), null);
  assert.equal(normalizeApiConversation({ id: "../outside" }), null);
  assert.deepEqual(mergeConversations([null]), []);
});

test("only nonempty usable conversation records at their exact provider URL are complete", () => {
  const record = { provider: "chatgpt", conversationId: "fixture-chat-1", url: "https://chatgpt.com/c/fixture-chat-1", extractionEvidence: { fullIdResponse: true, stableRender: true, complete: true }, messages: [{ role: "user", text: "Synthetic content" }] };
  assert.equal(isCompleteConversationRecord(record, "fixture-chat-1"), true);
  for (const invalid of [null, {}, { ...record, messages: [] }, { ...record, messages: [{ role: "", text: "Synthetic content" }] },
    { ...record, messages: [{ role: "user", text: "  " }] }, { ...record, messages: [{ role: "user", text: null }] },
    { ...record, extractionEvidence: undefined }, { ...record, extractionEvidence: { fullIdResponse: false, stableRender: true, complete: true } },
    { ...record, url: "https://example.invalid/c/fixture-chat-1" }, { ...record, url: "https://chatgpt.com/c/fixture-other" }]) {
    assert.equal(isCompleteConversationRecord(invalid, "fixture-chat-1"), false);
  }
  assert.equal(isCompleteConversationRecord(record, "fixture-chat"), false);
});

test("completed native branches normalize only user and assistant text", () => {
  const userOnly = { conversation_id: "fixture-chat", current_node: "user", mapping: {
    user: { parent: null, message: { author: { role: "user" }, status: "finished_successfully",
      content: { content_type: "text", parts: ["Synthetic question"] } } },
  } };
  assert.deepEqual(detailMessages(userOnly, "fixture-chat"), [{ role: "user", text: "Synthetic question" }]);

  const userAndAssistant = { conversation_id: "fixture-chat", current_node: "assistant", mapping: {
    user: { parent: null, message: { author: { role: "user" }, status: "finished_successfully",
      content: { content_type: "text", parts: ["Synthetic question"] } } },
    assistant: { parent: "user", message: { author: { role: "assistant" }, status: "finished_successfully", end_turn: true,
      content: { content_type: "text", parts: ["Synthetic answer"] } } },
  } };
  assert.deepEqual(detailMessages(userAndAssistant, "fixture-chat"), [
    { role: "user", text: "Synthetic question" }, { role: "assistant", text: "Synthetic answer" },
  ]);
});

test("unfinished or unknown native branch metadata rejects extraction", () => {
  const user = { author: { role: "user" }, status: "finished_successfully",
    content: { content_type: "text", parts: ["Synthetic question"] } };
  const assistant = { author: { role: "assistant" }, status: "finished_successfully", end_turn: true,
    content: { content_type: "text", parts: ["Synthetic answer"] } };
  for (const [name, changedUser, changedAssistant] of [
    ["assistant still generating", user, { ...assistant, status: "in_progress", end_turn: false }],
    ["assistant has not ended", user, { ...assistant, end_turn: false }],
    ["assistant end_turn missing", user, { ...assistant, end_turn: undefined }],
    ["assistant end_turn is not boolean", user, { ...assistant, end_turn: "true" }],
    ["user status missing", { ...user, status: undefined }, assistant],
    ["assistant status unknown", user, { ...assistant, status: "unknown" }],
  ]) {
    const payload = { conversation_id: "fixture-chat", current_node: "assistant", mapping: {
      user: { parent: null, message: changedUser }, assistant: { parent: "user", message: changedAssistant },
    } };
    assert.equal(detailMessages(payload, "fixture-chat"), null, name);
  }
});
