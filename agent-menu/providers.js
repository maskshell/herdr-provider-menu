// herdr-provider-menu — read cc-switch's provider store, build per-launch argv.
// Idea-level reference only (cc-switch & ccs, both MIT; no code copied): DESIGN.md §8.
import { exec, home, readTextFile } from "herdr";

/// shared() key for the last good read (menu opens instantly, then re-checks).
export const CACHE = "provider-menu.claude";

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

/// Claude providers of one machine (null: this one), cc-switch's order, current first.
/// Throws when sqlite3 or the database is missing — callers show a hint row.
export async function readProviders(machine) {
  const rows = await query(machine,
    "SELECT name, settings_config, meta, is_current FROM providers"
    + " WHERE app_type='claude' ORDER BY is_current DESC, sort_index ASC, name ASC");
  const commonRows = await query(machine, "SELECT value FROM settings WHERE key='common_config_claude'");
  const common = commonRows[0]?.value ? parse(commonRows[0].value, {}) : {};
  const commonEmpty = !common || Object.keys(common).length === 0;
  return rows.map(row => {
    const settings = parse(row.settings_config ?? "{}", {});
    const meta = parse(row.meta ?? "{}", {});
    // cc-switch semantics: the common config applies only when this provider
    // opted in (meta.commonConfigEnabled), and it wins over the provider's own.
    const merged = meta.commonConfigEnabled && !commonEmpty ? deepMerge(settings, common) : settings;
    return { name: String(row.name), current: Number(row.is_current) === 1, settings: merged,
             launchable: launchableCard(merged) };
  });
}

/// Per-launch argv for claude (Unix; Windows is Phase 2, DESIGN.md §4.2).
/// Takes the FINAL settings (launchSettings output). Never adds
/// --dangerously-skip-permissions: extra args are the caller's choice.
export function claudeArgv(settings, extra = []) {
  const unset = UNSET.flatMap(u => ["-u", u]);
  return ["env", ...unset, "claude", "--settings", JSON.stringify(settings), ...extra];
}

// ---------------------------------------------------------------------------
// Launch settings: cc-switch's "open provider terminal" recipe, mirrored
// (terminal_launch.rs write_claude_config + live/project/claude.rs
// terminal_model_picker). The temp --settings file stacks ON the user-level
// settings.json with env merged per key and top-level keys overridden per key:
// keys only the live file has would survive into this terminal, so they are
// written here as empty values. Empty string reads as unset (claude 2.1.314,
// upstream field test: placeholder creds stop being sent).

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
/// Blocks: every key the live user settings have and this card doesn't —
/// env keys as "", top-level keys as same-shape empties (numbers/bools are
/// left to inherit, as upstream does). modelPicker is always written: it wins
/// wholesale per level, so a live one must never leak through.
export function launchSettings(provider, liveText) {
  const ours = JSON.parse(JSON.stringify(provider.settings ?? {}));
  if (!ours.env || typeof ours.env !== "object" || Array.isArray(ours.env)) ours.env = {};
  const live = parse(liveText, null);
  if (live && typeof live === "object" && !Array.isArray(live)) {
    for (const [k, v] of Object.entries(live)) {
      if (k === "env") {
        if (v && typeof v === "object" && !Array.isArray(v))
          for (const name of Object.keys(v)) if (!(name in ours.env)) ours.env[name] = "";
      } else if (!(k in ours)) {
        if (typeof v === "string") ours[k] = "";
        else if (v && typeof v === "object") ours[k] = Array.isArray(v) ? [] : {};
      }
    }
  }
  ours.modelPicker = modelPicker(ours.env, provider.name);
  return ours;
}

/// The launch argv for one provider on one machine: read that machine's live
/// user settings first (unreadable → no blocks, upstream warns and proceeds
/// the same way). Relative path on remote (its home), absolute locally.
export async function launchArgv(provider, extra = [], machine = null) {
  let liveText = null;
  try {
    liveText = await readTextFile(machine ? ".claude/settings.json" : home() + "/.claude/settings.json", { on: machine });
  } catch { /* no live file (fresh home) or unreadable: launch without blocks */ }
  return claudeArgv(launchSettings(provider, liveText), extra);
}
