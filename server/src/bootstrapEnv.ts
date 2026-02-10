import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const start = trimmed[0];
    const end = trimmed[trimmed.length - 1];
    if ((start === "'" && end === "'") || (start === '"' && end === '"')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const equalIndex = trimmed.indexOf("=");
  if (equalIndex <= 0) {
    return undefined;
  }

  const key = trimmed.slice(0, equalIndex).trim();
  const value = stripSurroundingQuotes(trimmed.slice(equalIndex + 1));
  if (!key) {
    return undefined;
  }
  return { key, value };
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  const content = readFileSync(path, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

export function bootstrapEnv(): void {
  // Priority: .env.local > .env.example (fallback defaults for local dev)
  const root = process.cwd();
  loadEnvFile(resolve(root, ".env.local"));
  loadEnvFile(resolve(root, ".env.example"));
}
