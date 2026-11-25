// Device configuration: CLI flags, then the environment and ~/.dpi/backend.env (or $DPI_ENV_FILE),
// then ~/.dpi/settings.json (or $DPI_SETTINGS), then defaults.
// Nothing here knows about specific machines; dpi-network.yaml on the operator's laptop
// writes this env file through `just net up <device>`.
// settings.json uses Pi's names where they exist (defaultProvider, defaultModel, enabledModels).
// The token is a secret: it goes in ~/.dpi/auth.json (or $DPI_AUTH), as Pi keeps sign-ins in auth.json,
// or in backend.env / DPI_TOKEN. Never in settings.json.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";

export interface BackendConfig {
  name: string;
  host: string;
  port: number;
  home: string;
  envFile: string;
  settingsFile: string;
  authFile: string;
  dataDir: string;
  startDirs: string[];
  provider: "openrouter" | "faux" | "pi";
  /** pi provider: `provider/modelId` new sessions start on. */
  defaultModel?: string;
  /** pi provider: `provider/modelId` patterns to offer, `*` matching anything; empty offers every signed-in model. */
  models: string[];
  token: string;
}

/** ~/.dpi/settings.json. Every field is optional. */
export interface DeviceSettings {
  name?: string;
  host?: string;
  port?: number;
  dataDir?: string;
  startDirs?: string[];
  provider?: "openrouter" | "faux" | "pi";
  /** As in Pi: the provider of defaultModel. Optional when defaultModel is `provider/modelId`. */
  defaultProvider?: string;
  defaultModel?: string;
  /** As in Pi: `provider/modelId` patterns, `*` matching anything. */
  enabledModels?: string[];
}

const PROVIDERS = ["openrouter", "faux", "pi"] as const;

const providerOf = (value: string | undefined, where: string): BackendConfig["provider"] => {
  if (value === undefined || value === "") return "openrouter";
  if ((PROVIDERS as readonly string[]).includes(value)) return value as BackendConfig["provider"];
  throw Error(`${where}: provider must be one of ${PROVIDERS.join(", ")}, not ${JSON.stringify(value)}`);
};

const expand = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

const strings = (value: unknown, field: string, file: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    throw Error(`${file}: ${field} must be a list of strings`);
  return value as string[];
};

export function readSettings(file: string): DeviceSettings {
  if (!existsSync(file)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw Error(`${file}: invalid JSON (${e instanceof Error ? e.message : e})`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw Error(`${file}: expected a JSON object`);
  const s = value as Record<string, unknown>;
  for (const key of ["name", "host", "dataDir", "provider", "defaultProvider", "defaultModel"])
    if (s[key] !== undefined && typeof s[key] !== "string") throw Error(`${file}: ${key} must be a string`);
  if (s.port !== undefined && typeof s.port !== "number") throw Error(`${file}: port must be a number`);
  strings(s.startDirs, "startDirs", file);
  strings(s.enabledModels, "enabledModels", file);
  return s as DeviceSettings;
}

/** ~/.dpi/auth.json: `{ "token": "…" }`, readable by its owner only, as Pi's auth.json. */
export function readAuthToken(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0)
    throw Error(`${file}: other users can read this file. Run: chmod 600 ${file}`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw Error(`${file}: invalid JSON`);
  }
  const token = (value as { token?: unknown } | null)?.token;
  if (token !== undefined && typeof token !== "string") throw Error(`${file}: token must be a string`);
  return token;
}

/** `provider/modelId` from Pi-style fields: defaultModel alone when it has a slash, else defaultProvider/defaultModel. */
const defaultRef = (provider: string | undefined, model: string | undefined) =>
  !model ? undefined : model.includes("/") || !provider ? model : `${provider}/${model}`;

export function loadConfig(argv = process.argv.slice(2), env = process.env): BackendConfig {
  const flag = (key: string, fallback: string) => {
    const i = argv.indexOf(key);
    if (i < 0) return fallback;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw Error(`${key} needs a value`);
    return value;
  };
  const home = expand(env.DPI_HOME ?? join(homedir(), ".dpi"));
  const envFile = expand(flag("--env-file", env.DPI_ENV_FILE ?? join(home, "backend.env")));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const settingsFile = expand(flag("--settings", env.DPI_SETTINGS ?? join(home, "settings.json")));
  const s = readSettings(settingsFile);
  const authFile = expand(flag("--auth", env.DPI_AUTH ?? join(home, "auth.json")));
  const envModels = env.DPI_MODELS?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const config: BackendConfig = {
    name: flag("--name", env.DPI_DEVICE_NAME ?? s.name ?? hostname().replace(/\.local$/, "")),
    host: flag("--host", env.DPI_HOST ?? s.host ?? "127.0.0.1"),
    port: Number(flag("--port", env.DPI_PORT ?? String(s.port ?? 4780))),
    home,
    envFile,
    settingsFile,
    authFile,
    dataDir: resolve(expand(flag("--data-dir", env.DPI_DATA_DIR ?? s.dataDir ?? join(home, "backend")))),
    startDirs: (env.DPI_START_DIRS !== undefined || argv.includes("--start-dirs")
      ? flag("--start-dirs", env.DPI_START_DIRS ?? "").split(":")
      : (s.startDirs ?? ["~/dpi-work"])
    )
      .filter(Boolean)
      .map((p) => resolve(expand(p))),
    provider: env.DPI_PROVIDER
      ? providerOf(env.DPI_PROVIDER, "DPI_PROVIDER")
      : providerOf(s.provider, settingsFile),
    defaultModel: env.DPI_DEFAULT_MODEL || defaultRef(s.defaultProvider, s.defaultModel),
    models: envModels ?? s.enabledModels ?? [],
    token: env.DPI_TOKEN || readAuthToken(authFile) || "",
  };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw Error(`Invalid port: ${config.port}`);
  if (config.token.length < 32)
    throw Error(
      `DPI_TOKEN is missing or shorter than 32 characters (looked in ${authFile} and ${envFile}). Create one with: npm run token`,
    );
  return config;
}
