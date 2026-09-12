const { createPaths } = require("../core/paths");
const { ChatGPTAdapter } = require("../providers/chatgpt/adapter");

async function run(argv = [], deps = {}) {
  if (argv.length) throw new Error("login does not accept arguments");
  const adapter = deps.adapter || new ChatGPTAdapter({ paths: deps.paths || createPaths(deps.rootDir), chromeExecutable: deps.chromeExecutable });
  const output = deps.stdout || process.stdout;
  output.write("Sign in manually in the dedicated Chrome window. Waiting up to 10 minutes.\n");
  try {
    await adapter.login();
    output.write("Dedicated profile login verified.\n");
    return 0;
  } finally { await adapter.close(); }
}

module.exports = { run };
