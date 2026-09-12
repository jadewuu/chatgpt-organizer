#!/usr/bin/env node

const commandLoaders = new Map([
  ["doctor", () => require("./commands/doctor")],
  ["plan", () => require("./commands/plan")],
  ["apply", () => require("./commands/apply")],
  ["verify", () => require("./commands/verify")],
  ["clean:data", () => require("./commands/clean-data")],
]);

const usage = "Usage: pnpm organizer <doctor|plan|apply|verify|clean:data>\n";

function write(stream, message) {
  if (stream && typeof stream.write === "function") stream.write(message);
}

function injectedCommand(name, deps) {
  if (!deps.commands) return null;
  if (deps.commands instanceof Map) return deps.commands.get(name) || null;
  return deps.commands[name] || null;
}

function commandFor(name, deps) {
  const supplied = injectedCommand(name, deps);
  if (supplied) return typeof supplied === "function" ? { run: supplied } : supplied;
  if (name === "doctor" && deps.doctor) {
    return {
      async run(args, commandDeps) {
        const result = await deps.doctor(args, commandDeps);
        if (typeof result === "number") return result;
        if (!Array.isArray(result)) throw new Error("Injected doctor must return checks or an exit code");
        const output = commandDeps.stdout || process.stdout;
        for (const item of result) {
          output.write(`[${String(item.status).toUpperCase()}] ${item.name}: ${item.message}\n`);
        }
        return result.some((item) => item.status === "fail") ? 1 : 0;
      },
    };
  }
  return commandLoaders.get(name)();
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const name = args[0];
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  if (!commandLoaders.has(name)) {
    write(stderr, usage);
    return 2;
  }

  let command;
  try {
    command = commandFor(name, deps);
  } catch (error) {
    write(stderr, `Unable to load command "${name}": ${error.message}\n`);
    return 1;
  }
  if (!command || typeof command.run !== "function") {
    write(stderr, `Command "${name}" is unavailable or invalid\n`);
    return 1;
  }

  try {
    const code = await command.run(args.slice(1), { ...deps, stdout, stderr });
    return Number.isInteger(code) ? code : 0;
  } catch (error) {
    write(stderr, `Command "${name}" failed: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`Command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
