#!/usr/bin/env node
// Prints a scrypt hash for SUPER_ADMIN_PASSWORD_HASH.
// Usage: npm run hash-password            (prompts, input hidden)
//        npm run hash-password -- "secret" (non-interactive)
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

function hash(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

async function prompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = (s) => (s.includes("Password") ? write?.(s) : undefined);
  const answer = await new Promise((resolve) => rl.question("Password: ", resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const password = process.argv[2] ?? (await prompt());
if (!password || password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}
console.log(`SUPER_ADMIN_PASSWORD_HASH=${hash(password)}`);
