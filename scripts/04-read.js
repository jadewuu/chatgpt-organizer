// Compatibility wrapper; the verified original is recoverable in Git history.
const path = require("node:path");
const { createPaths } = require("../src/core/paths");
const { ChatGPTAdapter } = require("../src/providers/chatgpt/adapter");

async function main(args = process.argv.slice(2)) {
  process.stderr.write("Deprecated: scripts/04-read.js delegates to ChatGPTAdapter. Data now lives under .local/.\n");
  const paths = createPaths();
  const values = { "--max": Infinity, "--delay": 2500, "--cooldown-every": 0, "--cooldown-secs": 60, "--rebrowser-every": 0 };
  let all = false;
  let sample = null;
  let headless = false;
  const inputs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--headless") headless = true;
    else if (arg === "--all") all = true;
    else if (arg === "--sample" || Object.hasOwn(values, arg)) {
      const raw = args[++i];
      if (!/^\d+$/.test(raw || "") || !Number.isSafeInteger(Number(raw))) throw new Error(`Invalid value for ${arg}`);
      const value = Number(raw);
      if ((arg === "--sample" || arg === "--max") && value === 0) throw new Error(`Invalid value for ${arg}`);
      if (arg === "--sample") sample = value;
      else values[arg] = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else inputs.push(arg);
  }
  if (!all && sample === null && !inputs.length) throw new Error("Usage: scripts/04-read.js <full-id> [...] | --sample N | --all [--max N]");
  if (Number(all) + Number(sample !== null) + Number(inputs.length > 0) !== 1) throw new Error("Choose IDs, --sample, or --all");
  const adapter = new ChatGPTAdapter({ paths, headless });
  try {
    const list = adapter.readJson(path.join(paths.raw, "conversations.json")) || [];
    const resolveId = (input) => {
      if (list.some((item) => item.conversationId === input)) return input;
      const matches = list.filter((item) => item.conversationId.startsWith(input));
      if (matches.length > 1) throw new Error("Ambiguous conversation ID prefix; use the full ID");
      return matches[0]?.conversationId || input;
    };
    let ids = all || sample !== null ? list.slice(0, sample ?? Infinity).map((item) => item.conversationId) : inputs.map(resolveId);
    if ((all || sample !== null) && !list.length) throw new Error("No local inventory; run pnpm organizer discover first");
    if (all) ids = ids.filter((id) => !adapter.readJson(path.join(paths.raw, "conversations", `${id}.json`)));
    ids = ids.slice(0, values["--max"]);
    for (let i = 0; i < ids.length; i++) {
      await adapter.readConversation(ids[i]);
      process.stdout.write(`Read ${i + 1}/${ids.length} conversations.\n`);
      if (i + 1 === ids.length) break;
      await adapter.page.waitForTimeout(all ? values["--delay"] : 600);
      if (values["--cooldown-every"] > 0 && (i + 1) % values["--cooldown-every"] === 0) await adapter.page.waitForTimeout(values["--cooldown-secs"] * 1000);
      if (values["--rebrowser-every"] > 0 && (i + 1) % values["--rebrowser-every"] === 0) await adapter.close();
    }
  } finally { await adapter.close(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
