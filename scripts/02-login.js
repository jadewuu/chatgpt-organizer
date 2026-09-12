// Legacy implementation remains recoverable in Git history.
const { main } = require("../src/cli");
process.stderr.write("Deprecated: use pnpm organizer login. A fresh .local/profile is required.\n");
main(["login", ...process.argv.slice(2)]).then((code) => { process.exitCode = code; });
