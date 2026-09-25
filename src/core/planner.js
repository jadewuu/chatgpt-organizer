const { createHash } = require("node:crypto");
const { validateTaxonomy, validateClassifications, validateMigrationPlan } = require("./validate");
const { isCompleteConversationRecord } = require("../providers/chatgpt/normalize");

const DEFAULT_EXCERPT_CODE_POINTS = 2000;

function codePointLimit(value, limit = DEFAULT_EXCERPT_CODE_POINTS) {
  if (value == null) return "";
  const text = String(value);
  if (!Number.isSafeInteger(limit) || limit < 0) return text;
  return [...text].slice(0, limit).join("");
}

function classificationConfig(config = {}) {
  return config.classification || {};
}

function excerptLimit(config, options) {
  const classification = classificationConfig(config);
  const candidate = options.maxExcerptCodePoints
    ?? classification.maxExcerptCodePoints
    ?? classification.excerptMaxCodePoints
    ?? classification.maxExcerpt
    ?? classification.maxCodePoints
    ?? classification.maxExcerptLength;
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : DEFAULT_EXCERPT_CODE_POINTS;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractedById(extracted) {
  const map = new Map();
  const records = Array.isArray(extracted) ? extracted : Object.values(extracted || {});
  for (const record of records) {
    if (record && typeof record.conversationId === "string") map.set(record.conversationId, record);
  }
  return map;
}

function priorById(options = {}) {
  const values = options.priorClassifications ?? options.classifications ?? options.previousClassifications ?? [];
  const list = Array.isArray(values) ? values : Object.values(values || {});
  const map = new Map();
  for (const item of list) {
    if (item && typeof item.conversationId === "string") map.set(item.conversationId, item);
  }
  return map;
}

function userMessages(record) {
  return asArray(record?.messages).filter((message) => message && message.role === "user" && typeof message.text === "string");
}

function assertChatGPTConversation(conversation) {
  const conversationId = conversation?.conversationId;
  const expectedUrl = `https://chatgpt.com/c/${conversationId}`;
  let url;
  try { url = new URL(conversation?.url); } catch { url = null; }
  if (!conversation || conversation.provider !== "chatgpt"
    || typeof conversationId !== "string"
    || !/^[A-Za-z0-9_-]+$/.test(conversationId)
    || !url || url.protocol !== "https:" || url.hostname !== "chatgpt.com"
    || url.pathname !== `/c/${conversationId}` || url.search || url.hash
    || conversation.url !== expectedUrl) {
    throw new Error("Invalid ChatGPT conversation provider, ID, or URL");
  }
  return conversation;
}

function buildClassificationInput(conversations, extracted = [], config = {}, options = {}) {
  if (!Array.isArray(conversations)) throw new Error("conversations must be an array");
  const records = extractedById(extracted);
  const prior = priorById(options);
  const limit = excerptLimit(config, options);
  const threshold = classificationConfig(config).fullContentBelow ?? 0.9;
  return conversations.map((conversation) => {
    assertChatGPTConversation(conversation);
    const record = records.get(conversation.conversationId);
    if (!isCompleteConversationRecord(record, conversation.conversationId)) {
      throw new Error(`Complete extraction required for ${conversation.conversationId}; run node scripts/04-read.js --all before classification`);
    }
    const messages = userMessages(record);
    const first = messages[0]?.text || "";
    const last = messages.at(-1)?.text || "";
    const input = {
      conversationId: conversation.conversationId,
      title: conversation.title || "(untitled)",
      createdAt: conversation.createdAt ?? null,
      updatedAt: conversation.updatedAt ?? null,
      firstUserMessage: codePointLimit(first, limit),
      lastUserMessage: codePointLimit(last, limit),
    };
    const previous = prior.get(conversation.conversationId);
    if (options.allowFullContent === true && previous && typeof previous.confidence === "number"
      && previous.confidence < threshold) {
      const allMessages = asArray(records.get(conversation.conversationId)?.messages);
      const firstUserIndex = allMessages.findIndex((message) => message?.role === "user");
      let lastUserIndex = -1;
      for (let index = allMessages.length - 1; index >= 0; index--) {
        if (allMessages[index]?.role === "user") { lastUserIndex = index; break; }
      }
      const extra = allMessages
        .filter((message, index) => message && typeof message.text === "string" && index !== firstUserIndex && index !== lastUserIndex)
        .slice(0, 8)
        .map((message) => ({ role: message.role, text: codePointLimit(message.text, limit) }));
      if (extra.length) input.excerpts = extra;
    }
    return input;
  });
}

function canonicalize(value, isRoot = true) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, false));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .filter((key) => !(isRoot && key === "planHash"))
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key], false);
        return result;
      }, {});
  }
  return value;
}

function hashPlan(plan) {
  return createHash("sha256").update(JSON.stringify(canonicalize(plan))).digest("hex");
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : (now ?? new Date());
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid planner clock");
  return date.toISOString();
}

function taxonomyFromConfig(config) {
  const taxonomy = config?.taxonomy?.projects ? config.taxonomy : (config?.projects ? config : null);
  if (!taxonomy || !Array.isArray(taxonomy.projects)) throw new Error("A validated taxonomy is required");
  return validateTaxonomy(taxonomy);
}

function existingProjectNames(existingProjects) {
  return new Set(asArray(existingProjects).map((project) => typeof project === "string" ? project : project?.name).filter((name) => typeof name === "string"));
}

function buildMigrationPlan(conversations, classifications, config = {}, existingProjects = [], options = {}) {
  if (!Array.isArray(conversations)) throw new Error("conversations must be an array");
  if (!Array.isArray(classifications)) throw new Error("classifications must be an array");
  if (existingProjects && !Array.isArray(existingProjects) && typeof existingProjects === "object") {
    options = existingProjects;
    existingProjects = [];
  }
  const taxonomy = taxonomyFromConfig(config);
  for (const classification of classifications) {
    if (classification?.suggestedAction === "archive" && !classification.archiveReason) {
      throw new Error("Archive action requires an independent archive reason");
    }
  }
  validateClassifications(classifications);
  const conversationIds = new Set();
  for (const conversation of conversations) {
    assertChatGPTConversation(conversation);
    if (conversationIds.has(conversation.conversationId)) throw new Error(`Duplicate conversation ID: ${conversation.conversationId}`);
    conversationIds.add(conversation.conversationId);
  }
  const classificationsById = new Map();
  for (const classification of classifications) {
    if (!conversationIds.has(classification.conversationId)) throw new Error(`Unknown classification ID: ${classification.conversationId}`);
    if (classificationsById.has(classification.conversationId)) throw new Error(`Duplicate classification ID: ${classification.conversationId}`);
    classificationsById.set(classification.conversationId, classification);
  }
  for (const id of conversationIds) if (!classificationsById.has(id)) throw new Error(`Missing classification for conversation: ${id}`);

  const names = taxonomy.projects.map((project) => project.name);
  const nameSet = new Set(names);
  const moveThreshold = classificationConfig(config).moveThreshold ?? 0.95;
  const items = conversations.map((conversation) => {
    const classification = classificationsById.get(conversation.conversationId);
    if (classification.project !== null && !nameSet.has(classification.project)) {
      throw new Error(`Unknown Project in classification: ${classification.project}`);
    }
    const lowConfidence = classification.confidence < moveThreshold;
    const unresolved = lowConfidence || (classification.suggestedAction === "move" && classification.project === null);
    const item = {
      conversationId: conversation.conversationId,
      project: classification.project,
      confidence: classification.confidence,
      reason: classification.reason,
      suggestedAction: classification.suggestedAction,
      title: conversation.title || "(untitled)",
      url: conversation.url,
      currentProject: conversation.currentProject ?? null,
      action: unresolved ? "keep" : classification.suggestedAction,
      status: unresolved ? "unresolved" : "proposed",
    };
    if (classification.archiveReason !== undefined) item.archiveReason = classification.archiveReason;
    if (item.action === "archive" && !item.archiveReason) throw new Error("Archive action requires an independent archive reason");
    return item;
  });
  const existing = existingProjectNames(existingProjects);
  const projects = taxonomy.projects.map((project) => ({
    name: project.name,
    exists: existing.has(project.name),
    createRequired: !existing.has(project.name),
    proposedConversationCount: items.filter((item) => item.action === "move" && item.project === project.name).length,
  }));
  const plan = {
    provider: "chatgpt",
    generatedAt: nowIso(options.now),
    taxonomyHash: hashPlan(taxonomy),
    projects,
    items,
  };
  plan.planHash = hashPlan(plan);
  return validateMigrationPlan(plan);
}

module.exports = { buildClassificationInput, buildMigrationPlan, hashPlan, codePointLimit };
