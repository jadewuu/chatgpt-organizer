const test = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("./fixtures/conversations.json");
const { normalizeApiConversation, mergeConversations } = require("../src/providers/chatgpt/normalize");

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
