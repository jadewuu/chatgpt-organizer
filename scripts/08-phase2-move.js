const { parseArguments } = require("../src/commands/apply");
const { main: organizer } = require("../src/cli");

async function main(argv = process.argv.slice(2), deps = {}) {
  parseArguments(argv);
  return organizer(["apply", ...argv], deps);
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
