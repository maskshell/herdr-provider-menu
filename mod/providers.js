// herdr-provider-menu — read cc-switch's provider store, build per-launch argv.
// Idea-level reference only (cc-switch & ccs, both MIT; no code copied): DESIGN.md §8.
//
// Structure: one STRATEGY per harness (claude, codex, …) registered in HARNESS.
// A strategy implements classify(settings, meta, category) — can herdr rebuild
// this card per launch, and why not — and launch(card, machine, extra, rc) —
// the argv for one launch on one machine. Shared plumbing (DB query, live-file
// reads, extras, rc mode) lives here as the context; readProviders/launchArgv
// are thin dispatchers. A new harness is one new entry, no call-site branching.
import { exec, home, readTextFile, shared } from "herdr";

/// shared() key for the last good read (menu opens instantly, then re-checks).
export const CACHE = "provider-menu.claude";

/// shared() key for per-machine persistent extra argv ("" = this machine).
/// Explicit by design — the mod never adds flags itself (DESIGN.md §4.1);
/// this is the person's recorded choice, visible in the panel and in argv.
export const EXTRA = "provider-menu.extraArgs";

/// Shell-lite split for the extras string: whitespace-separated, single or
/// double quotes group (the same shape cc-switch's dialog input parses).
export function splitArgs(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/// shared() key for the per-machine "resolve the CLI through the shell
/// profile" mode ("" = this machine). Word-vector launches (herdr runs argv
/// as "$@" words) resolve FUNCTIONS but never ALIASES — aliases expand only
/// while the shell parses a command string, not on expansion results. The rc
/// mode builds that string (bash -[l]ic; -lic when a login rc file exists —
/// the upstream PR farion1231/cc-switch#9015/#9013 trick), so both apply.
/// In rc mode the profile IS the trust boundary: it runs before the CLI and
/// may export over what env -u cleaned.
export const RC = "provider-menu.rcLaunch";

/// Single-quote wrap with the '\'' escape — safe for arbitrary bytes.
function shellQuote(word) {
  return "'" + String(word).replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// RAM-only credential handoff (Phase 3, Pass 35/37). The launch command is
// the only transport herdr offers (tab.new has no env channel), and the
// target machine's core records that command in terminals.json — forever,
// with no cleanup. So the secret must NOT ride in the terminal argv at all:
// an exec (whose argv is NOT persisted) plants it in a 0600 file under
// /dev/shm (RAM-backed: never on disk, gone on reboot), and the terminal
// script only reads the PATH, deletes itself on exit, and refuses loudly
// when the file is gone (herdr may restart a terminal after its session
// died). Machines without /dev/shm (macOS) fall back to the inline argv —
// the old, documented persistence posture — and the panel asks before a
// cross-machine launch only in that fallback case.

const SHM_DIR = "/dev/shm";
const shmAvailable = new Map();

/// True when the machine can take the RAM-only handoff (probed once).
export async function handoffAvailable(machine = null) {
  const key = machine ?? "";
  if (shmAvailable.has(key)) return shmAvailable.get(key);
  let ok = false;
  try {
    const r = await exec("sh", ["-c", `test -d ${SHM_DIR} && test -w ${SHM_DIR}`], { on: machine });
    ok = r.code === 0;
  } catch { ok = false; }
  shmAvailable.set(key, ok);
  return ok;
}

/// Plant a secret on the machine and return the RAM file's path, or null
/// (caller falls back to the inline argv). mktemp names are [A-Za-z0-9./],
/// safe to embed unquoted in the scripts below.
async function handoffFile(machine, secret) {
  if (!secret) return null;
  try {
    const r = await exec("sh", ["-c",
      "f=$(mktemp " + SHM_DIR + "/herdr-pm.XXXXXXXXXXXX) && chmod 600 \"$f\" && printf %s " + shellQuote(secret) + " > \"$f\" && printf %s \"$f\""],
      { on: machine });
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  } catch { return null; }
}

/// The terminal script wrapper: read the secret, DELETE the file at once
/// (lifetime ≈ milliseconds — a trap would never fire past exec, and a KILL
/// would leak it; read-then-rm leaks nothing), refuse loudly when the file
/// is already gone (a terminal restarted after its session died), run body
/// with the secret in the shell variable $s.
function handoffScript(file, body) {
  return ["bash", "-c",
    's="$(cat ' + file + ' 2>/dev/null)"; [ -n "$s" ] || { echo \'provider credential file missing (session ended?) — relaunch from the menu\'; exit 1; }; rm -f ' + file + "; " + body];
}

function parse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/// `over` wins on conflicts, objects merge recursively, arrays replace.
function deepMerge(base, over) {
  for (const k of Object.keys(over)) {
    const v = over[k];
    if (v && typeof v === "object" && !Array.isArray(v)
      && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Shared context.

async function query(machine, sql) {
  // sqlite3 -json needs >= 3.33 and prints nothing for zero rows.
  const r = await exec("sqlite3", ["-readonly", "-json", dbPath(machine), sql], { on: machine });
  // A nonzero exit (missing/unreadable db, bad sql) prints nothing on stdout:
  // throw, or empty output would read as "no providers" (wrong hint).
  if (r.code !== 0) throw new Error("cc-switch.db: " + (r.stderr || ("exit " + r.code)).trim());
  return parse(r.stdout.trim() || "[]", []);
}

/// Relative on a remote (exec/readTextFile there resolve against THAT machine's
/// home — herdr.d.ts: "on that machine … its home by default"); absolute via
/// home() locally, where a relative path would land in the app process's cwd.
function dbPath(machine) {
  return machine ? ".cc-switch/cc-switch.db" : home() + "/.cc-switch/cc-switch.db";
}

/// The rc-mode probe result for one machine: {login} when a login rc file
/// exists (macOS keeps aliases in .bash_profile, which plain -ic never
/// reads — upstream issues #9013/#9015).
async function rcMode(machine) {
  if (!(shared(RC) ?? {})[machine ?? ""]) return null;
  let login = false;
  try { await readTextFile(machine ? ".bash_profile" : home() + "/.bash_profile", { on: machine }); login = true; } catch {}
  return { login };
}

/// The machine's home dir, absolute: home() locally; one exec on a remote
/// (paths must not depend on the app process's cwd or the terminal's cwd).
async function machineHome(machine) {
  if (!machine) return home();
  const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
  if (r.code !== 0 || !r.stdout.trim()) throw new Error("could not read $HOME on " + machine);
  return r.stdout.trim();
}

/// Read one text file on the machine (null when absent/unreadable — each
/// strategy decides whether that blocks the launch or just drops a guard).
async function readText(machine, rel, abs) {
  try { return await readTextFile(machine ? rel : abs, { on: machine }); } catch { return null; }
}

/// The person's per-machine extra argv, appended after caller-given ones.
function extraArgs(machine, extra) {
  return [...extra, ...splitArgs(String((shared(EXTRA) ?? {})[machine ?? ""] ?? ""))];
}

// ---------------------------------------------------------------------------
// Claude strategy.

/// Env names that would redirect claude to another identity; unset per launch
/// because settings.json's env block can only set, never unset. Names are facts;
/// the list mirrors cc-switch's CLAUDE_ACCOUNT_UNSET. DESIGN.md §4.1, test T2.
export const UNSET = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL", "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY", "CLAUDE_CODE_USE_MANTLE", "CLAUDE_CODE_USE_ANTHROPIC_AWS",
];

/// A card herdr can rebuild per-launch: an env block carrying its own token
/// identity (BASE_URL optional — token-only means the official endpoint).
/// Official-account OAuth cards and routed contracts have no such env form:
/// they only work through cc-switch itself. DESIGN.md §4.3, test T10.
function launchableCard(settings) {
  const env = settings?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return false;
  const has = k => typeof env[k] === "string" && env[k].trim() !== "";
  return has("ANTHROPIC_AUTH_TOKEN") || has("ANTHROPIC_API_KEY");
}

/// Per-launch argv for claude (Unix; Windows is Phase 2, DESIGN.md §4.2).
/// Takes the FINAL settings (launchSettings output). Never adds
/// --dangerously-skip-permissions: extra args are the caller's choice.
/// rc = {login} switches to the profile-following form: a shell-quoted
/// command string under bash -[l]ic, so the person's aliases AND functions
/// resolve claude (word vectors carry functions only). env -u still wraps it.
export function claudeArgv(settings, extra = [], rc = null) {
  const unset = UNSET.flatMap(u => ["-u", u]);
  if (rc) {
    const line = ["claude", "--settings", JSON.stringify(settings), ...extra].map(shellQuote).join(" ");
    return ["env", ...unset, "bash", rc.login ? "-lic" : "-ic", line];
  }
  return ["env", ...unset, "claude", "--settings", JSON.stringify(settings), ...extra];
}

/// Top-level keys blocked with same-shape empties: T8-verified safe as empty
/// values, and identity-relevant (model routing, terminal look, picker note).
const TOP_DROPS = ["model", "theme", "attribution"];

/// The /model menu for a per-launch terminal: only tiers this card explicitly
/// configured (a leaked picker would offer another provider's models here);
/// no rows → replaceBuiltInOptions=false shows the built-in menu.
const TIERS = [
  ["opus", "Opus", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION"],
  ["fable", "Fable", "ANTHROPIC_DEFAULT_FABLE_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME", "ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION"],
  ["sonnet", "Sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION"],
  ["haiku", "Haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION"],
];

function envString(env, key) {
  const v = env[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/// The 1M context marker is case-insensitive `[1m]` at the end of the model id.
function hasOneM(model) { return /\[1m\]\s*$/i.test(model ?? ""); }
function stripOneM(model) { return (model ?? "").replace(/\[1m\]\s*$/i, "").trim(); }

function modelPicker(env, providerName) {
  const rows = [];
  for (const [alias, label, key, nameKey, descKey] of TIERS) {
    const up = envString(env, key);
    if (!up) continue; // only tiers the card explicitly configured
    const name = envString(env, nameKey) || stripOneM(up);
    const fallback = (providerName.trim() ? providerName.trim() + " · " : "") + stripOneM(up) + (hasOneM(up) ? " · 1M" : "");
    rows.push({ model: alias, label: label + " · " + name, description: envString(env, descKey) || fallback });
  }
  return { replaceBuiltInOptions: rows.length > 0, options: rows };
}

/// Final per-launch settings = merged card + leak blocks + modelPicker.
/// Blocks: live-only env keys as "" (empty reads as unset), and live-only
/// TOP_DROPS keys as same-shape empties (verified safe). Every other live-only
/// top-level key inherits — machine preferences, and an unverified empty value
/// could invalidate the whole file (autoUpdatesChannel incident, 2026-11-19).
export function launchSettings(provider, liveText) {
  const ours = JSON.parse(JSON.stringify(provider.settings ?? {}));
  if (!ours.env || typeof ours.env !== "object" || Array.isArray(ours.env)) ours.env = {};
  const live = parse(liveText, null);
  if (live && typeof live === "object" && !Array.isArray(live)) {
    for (const [k, v] of Object.entries(live)) {
      if (k === "env") {
        if (v && typeof v === "object" && !Array.isArray(v))
          for (const name of Object.keys(v)) if (!(name in ours.env)) ours.env[name] = "";
      } else if (TOP_DROPS.includes(k) && !(k in ours)) {
        if (typeof v === "string") ours[k] = "";
        else if (v && typeof v === "object") ours[k] = Array.isArray(v) ? [] : {};
      }
    }
  }
  ours.modelPicker = modelPicker(ours.env, provider.name);
  return ours;
}

const claudeHarness = {
  /// Tab/section title for the UIs (panel header, new-tab name).
  title: "Claude",

  /// The common-config merge for claude: JSON objects, deep, common wins.
  mergeCommon(settings, common) { return deepMerge(settings, common); },

  classify(settings) {
    return { launchable: launchableCard(settings), reason: "" };
  },

  /// Reads the machine's live ~/.claude/settings.json first (unreadable →
  /// no blocks; upstream warns and proceeds the same way). The settings JSON
  /// goes through the RAM handoff when the machine has /dev/shm; the inline
  /// argv remains the fallback.
  async launch(card, machine, extra, rc) {
    const liveText = await readText(machine, ".claude/settings.json", home() + "/.claude/settings.json");
    const settings = launchSettings(card, liveText);
    const file = await handoffFile(machine, JSON.stringify(settings));
    if (file) {
      const tail = extra.map(shellQuote).join(" ");
      const unset = UNSET.map(u => "-u " + shellQuote(u)).join(" ");
      // rc mode exports the JSON for the inner profile shell ($PMS); the
      // plain mode uses "$s" directly — bash never re-evaluates var values.
      return handoffScript(file, rc
        ? 'export PMS="$s"; exec env ' + unset + " bash " + (rc.login ? "-lic" : "-ic") + " " + shellQuote('claude --settings "$PMS"' + (tail ? " " + tail : ""))
        : 'exec env ' + unset + ' claude --settings "$s"' + (tail ? " " + tail : ""));
    }
    return claudeArgv(settings, extra, rc);
  },
};

// ---------------------------------------------------------------------------
// Codex strategy (Phase 2). cc-switch stores a codex card as settings_config =
// { auth: {OPENAI_API_KEY} | string, config: "<toml text>" } and mirrors the
// card into the live ~/.codex/config.toml on switch. A per-launch terminal
// swaps the provider for ONE process with `codex -c key=value`, which layers
// ON config.toml per key: values change, keys never delete. The recipe
// mirrors cc-switch's terminal launcher (services/provider/codex_terminal.rs):
// the route table is rewritten under model_providers.custom with the key
// passed as env_key (never on the command line), live-only keys are either
// neutralized to no-effect values or the launch refuses ("switch to this
// card in cc-switch first"), matching upstream's uncovered-keys refusals.

/// The env var the rewritten route table reads the key from (upstream name).
export const CODEX_KEY_ENV = "CC_SWITCH_CODEX_API_KEY";
const CODEX_ROUTE = "custom";
const CODEX_BUILTIN = ["amazon-bedrock", "amazon-bedrock-runtime", "openai", "ollama", "lmstudio"];
const CODEX_RESERVED = ["openai", "ollama", "lmstudio"];

/// Floor/exclusive key sets as in cc-switch live/floor.rs — the keys a provider
/// switch writes (and therefore the keys a previous provider may leave behind).
const CODEX_FLOOR_TOP = ["model_provider", "openai_base_url", "model", "review_model", "model_reasoning_effort", "plan_mode_reasoning_effort", "disable_response_storage", "model_catalog_json", "experimental_bearer_token", "base_url", "wire_api"];
const CODEX_FLOOR_NESTED = [["agents", "default_subagent_model"], ["agents", "default_subagent_reasoning_effort"], ["memories", "extract_model"], ["memories", "consolidation_model"]];
const CODEX_EXCLUSIVE_TOP = ["web_search", "model_context_window", "model_auto_compact_token_limit", "model_supports_reasoning_summaries", "model_verbosity"];
/// Live route-table keys that are client behavior, not credentials: leaving
/// them behind is harmless (upstream PROXY_KEPT_CLIENT_KEYS).
const CODEX_KEPT = ["request_max_retries", "stream_max_retries", "stream_idle_timeout_ms"];

/// Line-oriented TOML subset for cc-switch-written configs: [table] headers,
/// key = value with raw TOML values kept verbatim (strings, numbers, bools,
/// inline tables, flat arrays). Values are stored as their source text so
/// re-rendering needs no quoting round-trip; tomlString() only unwraps
/// quoted strings for comparisons.
function parseToml(text) {
  const out = {};
  let prefix = [];
  for (let line of String(text ?? "").split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const h = line.match(/^\[\s*(.+?)\s*\]$/);
    if (h) { prefix = h[1].split(".").map(k => tomlString(k) ?? k); continue; }
    const m = line.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (!m) continue;
    const key = tomlString(m[1].trim()) ?? m[1].trim();
    out[[...prefix, key].join(".")] = stripTomlComment(m[2].trim());
  }
  return out;
}

/// Drop a trailing unquoted comment: quoted values keep any '#' inside the
/// quotes (a URL or token may contain one); bare values cut at " #".
function stripTomlComment(val) {
  if (val.startsWith('"')) return (val.match(/^"(?:[^"\\]|\\.)*"/) || [val])[0];
  if (val.startsWith("'")) return (val.match(/^'[^']*'/) || [val])[0];
  const i = val.indexOf(" #");
  return (i >= 0 ? val.slice(0, i) : val).trim();
}

/// The string inside a TOML quoted value, or null when raw is not a string.
function tomlString(raw) {
  if (raw == null) return null;
  const lit = raw.match(/^'([^']*)'$/);
  if (lit) return lit[1];
  const bas = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (bas) return bas[1].replace(/\\(["\\nrt])/g, (_, c) => ({ '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t" })[c]);
  return null;
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : "'" + key + "'";
}

/// Route classification for one codex card (mirrors live/project/codex.rs
/// third_party_route + the frontend's codexHasOwnRoute whitelist): launchable
/// ONLY when the card carries its own third-party route (a base_url table)
/// and a key. Everything else — official (follows Codex's own sign-in),
/// router-only formats, built-ins, keyless cards — refuses with a reason.
function classifyCodex(settings, meta, category) {
  if (category === "official") return { launchable: false, reason: "official" };
  if (meta?.is_full_url === true) return { launchable: false, reason: "router" };
  if (meta?.api_format === "openai_chat" || meta?.api_format === "anthropic") return { launchable: false, reason: "router" };
  const auth = settings?.auth;
  const key = typeof auth === "string" ? auth.trim()
    : auth && typeof auth === "object" && typeof auth.OPENAI_API_KEY === "string" ? auth.OPENAI_API_KEY.trim() : "";
  const toml = parseToml(settings?.config ?? "");
  const selector = tomlString(toml["model_provider"] ?? "") || null;
  const tablePath = id => "model_providers." + id;
  const tableOf = id => {
    const t = {};
    for (const [path, raw] of Object.entries(toml))
      if (path.startsWith(tablePath(id) + ".")) t[path.slice(tablePath(id).length + 1)] = raw;
    return t;
  };
  let table = null;
  if (!selector || selector === "openai") {
    // No selector (or "openai"): the legacy openai_base_url detour still names
    // a third-party endpoint; anything else follows Codex's own login.
    const detour = tomlString(toml["openai_base_url"] ?? "");
    if (!detour) return { launchable: false, reason: "follows-login" };
    table = { name: "'Custom'", base_url: JSON.stringify(detour), wire_api: "'responses'" };
  }
  else if (CODEX_RESERVED.includes(selector)) {
    // A reserved id with its own table: upstream rewrites those to custom.
    table = tableOf(selector);
    if (Object.keys(table).length === 0) return { launchable: false, reason: "builtin" };
  }
  else if (!CODEX_BUILTIN.includes(selector)) {
    table = tableOf(selector);
    if (Object.keys(table).length === 0) return { launchable: false, reason: "no-table" };
  }
  else return { launchable: false, reason: "builtin" }; // bedrock/ollama/lmstudio without a custom table
  if (!tomlString(table.base_url ?? "")) return { launchable: false, reason: "no-table" };
  if (tomlString(table.wire_api ?? "") === "chat") return { launchable: false, reason: "router" };
  const bearer = tomlString(table.experimental_bearer_token ?? "");
  if (!key && !bearer) return { launchable: false, reason: "no-key" };
  return { launchable: true, reason: "", toml, table, key: key || bearer };
}

/// Per-launch argv for codex (Unix). Takes classifyCodex's output plus the
/// machine's live config.toml text. Key travels in the environment (never on
/// the command line — env_key beats a leftover bearer, upstream §codex_terminal);
/// CODEX_HOME is pinned so a shell-exported one cannot redirect the process.
/// rc = {login} switches to the profile-following bash -[l]ic form, same as claude.
export function codexArgv(card, liveText, liveLogin, extra = [], rc = null, homeDir = null) {
  const env = [CODEX_KEY_ENV + "=" + (card.key || "")];
  if (homeDir) env.push("CODEX_HOME=" + homeDir.replace(/\/+$/, "") + "/.codex");
  const words = ["codex", "--no-daemon", ...codexOverrides(card, liveText, liveLogin), ...extra];
  if (rc) return ["env", ...env, "bash", rc.login ? "-lic" : "-ic", words.map(shellQuote).join(" ")];
  return ["env", ...env, ...words];
}

/// The -c overrides: rewritten route table, the card's own top/nested fields,
/// and neutralization of live-only leftovers (medium efforts, false summaries);
/// leftovers with no neutral form (catalog pointer, context window, uncovered
/// route-table keys, a selected profile) refuse the launch, as upstream does.
function codexOverrides(card, liveText, liveLogin) {
  const toml = card.toml ?? {};
  const live = parseToml(liveText ?? "");
  const fail = keys => { throw new Error("codex config.toml keeps " + keys + " from the current provider — switch to this card in cc-switch first"); };
  if ("profile" in live) fail("a selected profile");

  const ours = {};
  for (const [k, raw] of Object.entries(card.table)) {
    if (k === "experimental_bearer_token") continue; // moved into the env var
    ours[k] = raw;
  }
  ours.env_key = JSON.stringify(CODEX_KEY_ENV);
  ours.requires_openai_auth = liveLogin ? "true" : "false";
  if (!ours.wire_api) ours.wire_api = "'responses'";
  if (!ours.supports_websockets) ours.supports_websockets = "false";
  const liveTablePrefix = "model_providers." + CODEX_ROUTE + ".";
  const uncovered = Object.keys(live).filter(p => p.startsWith(liveTablePrefix))
    .map(p => p.slice(liveTablePrefix.length))
    .filter(k => !(k in ours) && k !== "experimental_bearer_token" && !CODEX_KEPT.includes(k));
  if (uncovered.length) fail("model_providers.custom." + uncovered.join(", "));

  const out = ["model_provider='" + CODEX_ROUTE + "'",
    "model_providers." + CODEX_ROUTE + "=" + "{" + Object.entries(ours).map(([k, v]) => tomlKey(k) + "=" + v).join(",") + "}"];

  const model = tomlString(toml["model"] ?? "");
  const set = (path, raw) => out.push(path + "=" + raw);
  for (const k of ["model", "review_model", "model_reasoning_effort", "plan_mode_reasoning_effort"])
    if (toml[k] != null) set(k, toml[k]);
  for (const k of CODEX_EXCLUSIVE_TOP)
    if (toml[k] != null) set(k, toml[k]);
  for (const segs of CODEX_FLOOR_NESTED)
    if (toml[segs.join(".")] != null) set(segs.join("."), toml[segs.join(".")]);

  // Neutralize what the previous provider left in live and this card does not set.
  const written = new Set(out.map(o => o.slice(0, o.indexOf("="))));
  const neutral = { model_reasoning_effort: "'medium'", plan_mode_reasoning_effort: "'medium'", model_supports_reasoning_summaries: "false", model_verbosity: "'medium'" };
  for (const k of [...CODEX_FLOOR_TOP, ...CODEX_EXCLUSIVE_TOP]) {
    if (!(k in live) || written.has(k)) continue;
    if (["model_provider", "openai_base_url", "experimental_bearer_token", "base_url", "wire_api", "disable_response_storage", "web_search"].includes(k)) continue;
    if (k === "model_catalog_json" || k === "model_context_window" || k === "model_auto_compact_token_limit") fail(k);
    if (k === "model" || k === "review_model") { if (model == null) fail(k); set(k, toml["model"]); continue; }
    if (neutral[k]) { set(k, neutral[k]); continue; }
    fail(k);
  }
  for (const segs of CODEX_FLOOR_NESTED) {
    const path = segs.join(".");
    if (!(path in live) || written.has(path)) continue;
    if (path.endsWith("default_subagent_reasoning_effort")) { set(path, "'medium'"); continue; }
    if (model == null) fail(path);
    set(path, toml["model"]);
  }
  return out.flatMap(o => ["-c", o]);
}

/// Whether the live codex auth.json carries credential material (decides
/// requires_openai_auth, as upstream computes it from the disk login).
async function codexLiveLogin(machine) {
  const text = await readText(machine, ".codex/auth.json", home() + "/.codex/auth.json");
  const auth = parse(text, null);
  if (!auth || typeof auth !== "object") return false;
  return (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim() !== "") || !!auth.tokens;
}

const codexHarness = {
  title: "Codex",

  /// The common-config merge for codex: TOML texts concatenated, the snippet's
  /// keys win (the parser lets later lines override earlier ones).
  mergeCommon(settings, common) {
    if (typeof common !== "string" || common.trim() === "") return settings;
    return { auth: settings.auth, config: String(settings.config ?? "") + "\n" + common };
  },

  classify(settings, meta, category) {
    return classifyCodex(settings, meta, category);
  },

  /// Reads the machine's live ~/.codex/config.toml (unreadable → no
  /// neutralization) and auth.json (login flag), pins CODEX_HOME. The key
  /// goes through the RAM handoff when the machine has /dev/shm; the inline
  /// env word remains the fallback.
  async launch(card, machine, extra, rc) {
    const liveText = await readText(machine, ".codex/config.toml", home() + "/.codex/config.toml");
    const homeDir = await machineHome(machine);
    const login = await codexLiveLogin(machine);
    const file = await handoffFile(machine, String(card.key ?? ""));
    if (file) {
      const quoted = ["codex", "--no-daemon", ...codexOverrides(card, liveText, login), ...extra].map(shellQuote).join(" ");
      const head = "export " + CODEX_KEY_ENV + '="$s"; export CODEX_HOME=' + shellQuote(homeDir.replace(/\/+$/, "") + "/.codex") + "; ";
      return handoffScript(file, rc
        ? head + "exec bash " + (rc.login ? "-lic" : "-ic") + " " + shellQuote(quoted)
        : head + "exec " + quoted);
    }
    return codexArgv(card, liveText, login, extra, rc, homeDir);
  },
};

// ---------------------------------------------------------------------------
// Registry + dispatch.

export const HARNESS = { claude: claudeHarness, codex: codexHarness };

/// The refusal sentence for a card herdr cannot launch — the single source
/// for both UIs (the docked panel and the agent-menu submenu show the same
/// words). Codex notes mirror cc-switch's own terminal gating: official cards
/// follow Codex's sign-in, router-only formats need its local proxy.
export function cardNote(card, app = "claude") {
  const notes = {
    codex: {
      official: "follows Codex's own sign-in — switch to it in cc-switch, not here.",
      router: "needs cc-switch's local router — switch there, not here.",
      "no-key": "has no API key — add one in cc-switch first.",
      "no-table": "has no route table (base_url) — fix the card in cc-switch first.",
      "follows-login": "has no route of its own — switch to it in cc-switch first.",
      builtin: "selects a built-in provider — switch to it in cc-switch first.",
    },
  };
  return card.name + " " + ((notes[app] ?? {})[card.reason]
    || "is not an env-form API card (official or routed?) — switch to it in cc-switch, not here.");
}

/// Providers of one machine (null: this one), cc-switch's order, current first.
/// Throws when sqlite3 or the database is missing — callers show a hint row.
export async function readProviders(machine, app = "claude") {
  const harness = HARNESS[app] ?? claudeHarness;
  const rows = await query(machine,
    "SELECT name, category, settings_config, meta, is_current FROM providers"
    + " WHERE app_type='" + app + "' ORDER BY is_current DESC, sort_index ASC, name ASC");
  const commonRows = await query(machine, "SELECT value FROM settings WHERE key='common_config_" + app + "'");
  const common = commonRows[0]?.value ? parse(commonRows[0].value, null) : null;
  const commonEmpty = !common || (typeof common === "object" && Object.keys(common).length === 0);
  return rows.map(row => {
    const settings = parse(row.settings_config ?? "{}", {});
    const meta = parse(row.meta ?? "{}", {});
    // cc-switch semantics: the common config applies only when this provider
    // opted in (meta.commonConfigEnabled), and it wins over the provider's own.
    const merged = meta.commonConfigEnabled && !commonEmpty ? harness.mergeCommon(settings, common) : settings;
    const card = { name: String(row.name), current: Number(row.is_current) === 1, settings: merged, ...harness.classify(merged, meta, row.category) };
    return card;
  });
}

/// The launch argv for one provider on one machine: the harness strategy
/// builds it; extras (caller + the person's recorded per-machine ones) and
/// the rc mode resolve here, shared. Dynamic env conventions live in the rc
/// mode (RC key): the profile is the general mechanism, the mod hardcodes none.
export async function launchArgv(provider, extra = [], machine = null, app = "claude") {
  const harness = HARNESS[app] ?? claudeHarness;
  return harness.launch(provider, machine, extraArgs(machine, extra), await rcMode(machine));
}
