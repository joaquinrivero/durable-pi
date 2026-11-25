// Create (or with --rotate, replace) the device token and print it.
// With --json, or when $DPI_HOME/auth.json exists, it lives in auth.json ({"token": "…"}, mode 600, as Pi's auth.json);
// otherwise in $DPI_HOME/backend.env as DPI_TOKEN.
// `just net up <device>` does this remotely; this script is for manual setups.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const home = process.env.DPI_HOME ?? join(homedir(), ".dpi");
const authFile = process.env.DPI_AUTH ?? join(home, "auth.json");
const envFile = process.env.DPI_ENV_FILE ?? join(home, "backend.env");
const rotate = process.argv.includes("--rotate");
const fresh = () => `dpi_${randomBytes(32).toString("base64url")}`;

if (process.argv.includes("--json") || existsSync(authFile)) {
  mkdirSync(dirname(authFile), { recursive: true, mode: 0o700 });
  const auth = existsSync(authFile) ? (JSON.parse(readFileSync(authFile, "utf8")) as Record<string, unknown>) : {};
  if (typeof auth.token !== "string" || rotate) auth.token = fresh();
  writeFileSync(authFile, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
  chmodSync(authFile, 0o600);
  console.log(auth.token);
} else {
  mkdirSync(dirname(envFile), { recursive: true, mode: 0o700 });
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const current = text.match(/^DPI_TOKEN=(.+)$/m)?.[1];
  if (current && !rotate) {
    console.log(current);
  } else {
    const token = fresh();
    const rest = text.replace(/^DPI_TOKEN=.*\n?/m, "");
    writeFileSync(envFile, `DPI_TOKEN=${token}\n${rest}`, { mode: 0o600 });
    console.log(token);
  }
}
