const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("agent entry points share the same safety contract", () => {
  const agents = fs.readFileSync("AGENTS.md", "utf8");
  const claude = fs.readFileSync("CLAUDE.md", "utf8");
  const codexSkill = fs.readFileSync(".agents/skills/chatgpt-organizer/SKILL.md", "utf8");
  const claudeSkill = fs.readFileSync(".claude/skills/chatgpt-organizer/SKILL.md", "utf8");
  assert.match(agents, /read-only by default/i);
  assert.match(agents, /never delete/i);
  assert.match(claude, /AGENTS\.md/);
  assert.match(codexSkill, /docs\/workflow\.md/);
  assert.match(claudeSkill, /docs\/workflow\.md/);
});
