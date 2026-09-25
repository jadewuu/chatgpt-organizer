const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const { renderReviewHtml } = require("../src/reports/review");
const { createPaths } = require("../src/core/paths");
const { createRunState, loadRunState, saveRunState } = require("../src/core/state");
const { buildClassificationInput } = require("../src/core/planner");
const { run } = require("../src/commands/plan");

function createSymlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (["EACCES", "EPERM", "ENOSYS"].includes(error.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

const taxonomy = {
  projects: [
    { name: "Work & <Team>", description: "Work \"items\" & plans", include: [], exclude: [] },
    { name: "New 'Ideas'", description: "A project to create", include: [], exclude: [] },
  ],
};

const plan = {
  provider: "chatgpt",
  generatedAt: "2026-09-12T00:00:00.000Z",
  taxonomyHash: "taxonomy-hash",
  planHash: "exact-plan-hash",
  projects: [
    { name: "Work & <Team>", exists: true, createRequired: false, proposedConversationCount: 1 },
    { name: "New 'Ideas'", exists: false, createRequired: true, proposedConversationCount: 0 },
  ],
  items: [
    {
      conversationId: "chat-1&<>'\"",
      title: "<script>alert(1)</script>",
      url: "https://chatgpt.com/c/chat-1&<>'\"",
      currentProject: "Current <Project>",
      project: "Work & <Team>",
      confidence: 0.97,
      reason: "Move because & < > \" '",
      archiveReason: "Archive reason & < > \" '",
      suggestedAction: "move",
      action: "move",
      status: "proposed",
    },
    {
      conversationId: "chat-2",
      title: "Needs review",
      url: "https://chatgpt.com/c/chat-2",
      currentProject: null,
      project: null,
      confidence: 0.5,
      reason: "Not enough context",
      suggestedAction: "move",
      action: "keep",
      status: "unresolved",
    },
    {
      conversationId: "chat-3",
      title: "Archive candidate",
      url: "https://chatgpt.com/c/chat-3",
      currentProject: "Old",
      project: null,
      confidence: 0.99,
      reason: "No useful destination",
      archiveReason: "Obsolete conversation",
      suggestedAction: "archive",
      action: "archive",
      status: "proposed",
    },
  ],
};

test("renderReviewHtml escapes all HTML-sensitive characters and shows review buckets", () => {
  const html = renderReviewHtml({ taxonomy, plan });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;/);
  assert.match(html, /&#39;/);
  assert.match(html, /Proposed moves/);
  assert.match(html, /Unresolved/);
  assert.match(html, /Archive candidates/);
  assert.match(html, /Total conversations/);
  assert.match(html, /Coverage/);
  assert.match(html, /Work &amp; &lt;Team&gt;/);
  assert.match(html, /New &#39;Ideas&#39;/);
  assert.match(html, /createRequired/);
  assert.match(html, /exact-plan-hash/);
  assert.match(html, /Current &lt;Project&gt;/);
  assert.match(html, /Archive reason &amp; &lt; &gt; &quot; &#39;/);
  assert.match(html, /Suggested action/);
  assert.match(html, /Executable action/);
});

test("renderReviewHtml is deterministic and has no external resources", () => {
  const first = renderReviewHtml({ taxonomy, plan });
  const second = renderReviewHtml({ taxonomy, plan });
  assert.equal(first, second);
  assert.doesNotMatch(first, /<(?:link|img|iframe|audio|video)\b/i);
  assert.doesNotMatch(first, /(?:src|href|action)\s*=\s*["']https?:/i);
  assert.doesNotMatch(first, /@import\s+url|fetch\s*\(|XMLHttpRequest|eval\s*\(/i);
});

test("unresolved counts and bucket include only unresolved statuses", () => {
  const html = renderReviewHtml({
    taxonomy,
    plan: {
      ...plan,
      items: [
        {
          ...plan.items[1],
          title: "Actually unresolved",
        },
        {
          ...plan.items[1],
          title: "Intentional keep",
          project: "Work & <Team>",
          confidence: 0.99,
          reason: "Already belongs in the right Project",
          suggestedAction: "keep",
          action: "keep",
          status: "proposed",
        },
      ],
    },
  });
  const unresolvedSection = html.match(/<section><h2>Unresolved .*?<\/section>/s)?.[0];

  assert.match(html, /<strong>1<\/strong>Unresolved/);
  assert.match(unresolvedSection, /Actually unresolved/);
  assert.doesNotMatch(unresolvedSection, /Intentional keep/);
  assert.match(html, /<h3>Intentional keep<\/h3>/);
  assert.match(html, /Already belongs in the right Project/);
});

test("plan writes a private atomic review report before entering PLAN_REVIEW", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-report-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const conversations = [{
    provider: "chatgpt", conversationId: "fixture-chat-1", title: "Synthetic chat",
    createdAt: 1, updatedAt: 2, currentProject: null,
    url: "https://chatgpt.com/c/fixture-chat-1",
  }];
  const extracted = [{ provider: "chatgpt", conversationId: "fixture-chat-1", url: conversations[0].url,
    extractionEvidence: { fullIdResponse: true, stableRender: true, complete: true }, messages: [{ role: "user", text: "first" }] }];
  fs.mkdirSync(paths.raw, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), `${JSON.stringify(conversations)}\n`);
  fs.mkdirSync(path.join(paths.raw, "conversations"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.raw, "conversations", "fixture-chat-1.json"), `${JSON.stringify(extracted[0])}\n`);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  const config = { provider: "chatgpt", classification: { moveThreshold: 0.95 }, taxonomy };
  fs.writeFileSync(path.join(root, "config", "organizer.example.yaml"), YAML.stringify(config));
  fs.mkdirSync(paths.plans, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.plans, "taxonomy.yaml"), YAML.stringify(taxonomy));
  fs.writeFileSync(path.join(paths.plans, "classification-input.jsonl"), `${buildClassificationInput(conversations, extracted, config).map((row) => JSON.stringify(row)).join("\n")}\n`);
  fs.writeFileSync(path.join(paths.plans, "classifications.json"), JSON.stringify([{
    conversationId: "fixture-chat-1", project: "Work & <Team>", confidence: 0.99,
    reason: "Synthetic", suggestedAction: "move",
  }]));
  const state = createRunState("run", "account");
  state.phase = "CLASSIFY";
  saveRunState(paths, state);
  fs.mkdirSync(paths.reports, { mode: 0o700 });
  const reportEscape = path.join(root, "report-escape.txt");
  fs.writeFileSync(reportEscape, "outside stays unchanged\n");
  if (!createSymlinkOrSkip(t, reportEscape, path.join(paths.reports, "review.html.tmp"), "file")) return;
  const output = { chunks: [], write(value) { this.chunks.push(value); } };

  assert.equal(await run([], { rootDir: root, paths, stdout: output, now: "2026-09-12T00:00:00.000Z" }), 0);
  const reportPath = path.join(paths.reports, "review.html");
  assert.equal(fs.existsSync(reportPath), true);
  assert.equal(fs.statSync(paths.reports).mode & 0o777, 0o700);
  assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
  assert.equal(fs.lstatSync(`${reportPath}.tmp`).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(reportEscape, "utf8"), "outside stays unchanged\n");
  assert.match(output.chunks.at(-1), new RegExp(`${reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(output.chunks.join(""), /No ChatGPT changes were made/i);
  assert.equal(loadRunState(paths).phase, "PLAN_REVIEW");
});

test("symlinked report directory fails closed and preserves CLASSIFY state", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-report-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const conversations = [{ provider: "chatgpt", conversationId: "fixture-chat-1", title: "Chat", createdAt: 1, updatedAt: 2, currentProject: null, url: "https://chatgpt.com/c/fixture-chat-1" }];
  const config = { provider: "chatgpt", classification: { moveThreshold: 0.95 }, taxonomy: { projects: [{ name: "Work", description: "Work", include: [], exclude: [] }] } };
  fs.mkdirSync(paths.raw, { recursive: true });
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), JSON.stringify(conversations));
  fs.mkdirSync(path.join(paths.raw, "conversations"), { recursive: true });
  fs.mkdirSync(paths.plans, { recursive: true });
  fs.writeFileSync(path.join(paths.plans, "taxonomy.yaml"), YAML.stringify(config.taxonomy));
  const extracted = [{ ...conversations[0], extractionEvidence: { fullIdResponse: true, stableRender: true, complete: true }, messages: [{ role: "user", text: "first" }] }];
  fs.writeFileSync(path.join(paths.plans, "classification-input.jsonl"), `${buildClassificationInput(conversations, extracted, config).map((row) => JSON.stringify(row)).join("\n")}\n`);
  fs.writeFileSync(path.join(paths.plans, "classifications.json"), JSON.stringify([{ conversationId: "fixture-chat-1", project: "Work", confidence: 0.99, reason: "r", suggestedAction: "move" }]));
  const state = createRunState("run", "account"); state.phase = "CLASSIFY"; saveRunState(paths, state);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-report-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  if (!createSymlinkOrSkip(t, outside, paths.reports, "dir")) return;

  await assert.rejects(run([], { rootDir: root, paths, config }), /symlink|directory/i);
  assert.equal(loadRunState(paths).phase, "CLASSIFY");
  assert.equal(fs.existsSync(path.join(outside, "review.html")), false);
});

test("full-content-only flow never creates a report", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-organizer-report-full-content-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createPaths(root);
  const conversations = [{ provider: "chatgpt", conversationId: "fixture-chat-1", title: "Chat", createdAt: 1, updatedAt: 2, currentProject: null, url: "https://chatgpt.com/c/fixture-chat-1" }];
  const extracted = [{ provider: "chatgpt", conversationId: "fixture-chat-1", url: conversations[0].url,
    extractionEvidence: { fullIdResponse: true, stableRender: true, complete: true }, messages: [{ role: "user", text: "first" }, { role: "assistant", text: "middle" }, { role: "user", text: "last" }] }];
  const config = { provider: "chatgpt", classification: { moveThreshold: 0.95, fullContentBelow: 0.9 }, taxonomy: { projects: [{ name: "Work", description: "Work", include: [], exclude: [] }] } };
  fs.mkdirSync(paths.raw, { recursive: true });
  fs.writeFileSync(path.join(paths.raw, "conversations.json"), JSON.stringify(conversations));
  fs.mkdirSync(path.join(paths.raw, "conversations"), { recursive: true });
  fs.writeFileSync(path.join(paths.raw, "conversations", "fixture-chat-1.json"), JSON.stringify(extracted[0]));
  fs.mkdirSync(paths.plans, { recursive: true });
  fs.writeFileSync(path.join(paths.plans, "taxonomy.yaml"), YAML.stringify(config.taxonomy));
  fs.writeFileSync(path.join(paths.plans, "classification-input.jsonl"), `${buildClassificationInput(conversations, extracted, config).map((row) => JSON.stringify(row)).join("\n")}\n`);
  fs.writeFileSync(path.join(paths.plans, "classifications.json"), JSON.stringify([{ conversationId: "fixture-chat-1", project: "Work", confidence: 0.89, reason: "uncertain", suggestedAction: "move" }]));
  const state = createRunState("run", "account"); state.phase = "CLASSIFY"; saveRunState(paths, state);
  assert.equal(await run(["--allow-full-content"], { rootDir: root, paths, config }), 0);
  assert.equal(fs.existsSync(path.join(paths.reports, "review.html")), false);
  assert.equal(loadRunState(paths).phase, "CLASSIFY");
});
