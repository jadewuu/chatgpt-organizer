const { createPaths } = require("../core/paths");
const { ChatGPTAdapter } = require("../providers/chatgpt/adapter");

async function run(argv = [], deps = {}) {
  let max = Infinity;
  if (argv.length) {
    if (argv.length !== 2 || argv[0] !== "--max" || !/^[1-9]\d*$/.test(argv[1]) || !Number.isSafeInteger(Number(argv[1]))) {
      throw new Error("Usage: discover [--max <positive integer>]");
    }
    max = Number(argv[1]);
  }
  const adapter = deps.adapter || new ChatGPTAdapter({ paths: deps.paths || createPaths(deps.rootDir), chromeExecutable: deps.chromeExecutable });
  try {
    const records = await adapter.discoverConversations({ max });
    (deps.stdout || process.stdout).write(`Discovered ${records.length} conversations in .local/raw/conversations.json\n`);
    return 0;
  } finally { await adapter.close(); }
}

module.exports = { run };
