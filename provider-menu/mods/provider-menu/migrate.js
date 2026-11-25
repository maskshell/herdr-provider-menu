// herdr-provider-menu — T12: move an agent session (and its workspace) to
// another machine. The session's transcript is dense with file-state
// references, so the workspace travels WITH it as one snapshot: the target
// is never a foreign tree. Semantics (DESIGN.md §T12):
//
//   - first move: full copy into an EMPTY dir, both ends stamped with a
//     lineage marker (.herdr-migrated: {id, manifest});
//   - return move: the marker on the target proves lineage → manifest
//     delta (copy changed/added, delete vanished);
//   - anything else (non-empty, no matching marker): refuse — identity
//     unknown, never graft onto a foreign tree.
//
// All file content moves as base64 through exec argv chunks (binary-safe,
// one code path; each argument stays under MAX_ARG_STRLEN). The marker is
// small JSON via writeTextFile. mtime never travels (the channel rewrites
// it); the stored manifest is the target's ground truth, not the clock.
// Machine paths reach shells as sh -c "$1"-style arguments — no quoting
// puzzles, spaces included.
import { exec, readTextFile } from "herdr";
import { machineHome } from "./providers.js";

/// shared() key for the in-flight move (the panel's staging card): the
/// staged source session plus the chosen target, null-ish fields until set.
export const MOVE = "provider-menu.move";

/// The lineage marker's file name — load-bearing: the exclusion list below
/// must never match it, and both ends of a lineage carry it.
export const MARKER = ".herdr-migrated";

/// Regenerable build output: copied never (the agent reinstalls); listed in
/// the confirm dialog, so the person can see what stays behind.
export const EXCLUDE = ["node_modules", "target", "dist", "build", "out", ".next", ".nuxt",
  ".output", ".svelte-kit", ".venv", "venv", "__pycache__", ".cache", ".mypy_cache",
  ".pytest_cache", ".turbo", "coverage", ".DS_Store"];

/// One argv-safe base64 chunk of raw bytes (multiple of 4 so consecutive
/// decode-appends stay aligned). MAX_ARG_STRLEN is 128KB per argument; stay
/// well under with quoting overhead.
const CHUNK = 96 * 1024;

function shellQuote(word) {
  return "'" + String(word).replace(/'/g, "'\\''") + "'";
}

/// ~/.claude/projects encodes the absolute working dir: every "/" becomes
/// "-" (including the leading one). Observed, not documented — a claude
/// upgrade that changes this breaks resume-by-slug, loudly.
export function slugOf(path) {
  return String(path ?? "").replace(/\/+$/, "").replace(/\//g, "-");
}

/// A fresh lineage id for a first move (both ends get stamped with it).
export function newId() {
  return "hm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Session discovery.

/// The live claude session for one workspace on one machine: the newest
/// *.jsonl under ~/.claude/projects/<slug>/ (the file being appended now).
/// Returns {uuid, side, dir} — dir is the shell-usable slug dir path on the
/// SOURCE machine, side marks the checkpoint dir next to the transcript —
/// or null when the workspace has no session there.
export async function findClaudeSession(machine, root) {
  const slug = slugOf(root);
  const r = await exec("sh", ["-c",
    'd="$HOME/.claude/projects/$1"; f=$(ls -t "$d"/*.jsonl 2>/dev/null | head -1);'
    + ' [ -n "$f" ] || exit 1; b=$(basename "$f" .jsonl);'
    + " printf '%s\\t%s' \"$(basename \"$f\" .jsonl)\" \"$d\";"
    + ' [ -d "$d/$(basename "$f" .jsonl)" ] && printf "\\tside"' + "; exit 0",
    "sh", slug], { on: machine });
  if (r.code !== 0 || !r.stdout.trim()) return null;
  const [uuid, dir, side] = r.stdout.trim().split("\t");
  return uuid ? { uuid, dir, side: side === "side" } : null;
}

/// The live codex session for one workspace: the newest rollout whose
/// session_meta line carries cwd == root. Returns {rel} (the rollout's path
/// under ~/.codex/sessions, shell-usable) or null.
export async function findCodexSession(machine, root) {
  const r = await exec("sh", ["-c",
    'cd "$HOME/.codex/sessions" 2>/dev/null || exit 1;'
    + " n=$(printf '\"cwd\":\"%s\"' \"$1\");"
    // No find -printf here (or below): it is a GNU extension. ls -t on the
    // whole batch is the portable newest-first order.
    + ' for f in $(find . -name "rollout-*.jsonl" -exec ls -t {} + 2>/dev/null); do'
    + ' head -1 "$f" | grep -qF "$n" && { printf %s "$f"; exit 0; };'
    + ' done; exit 1',
    "sh", root], { on: machine });
  if (r.code !== 0 || !r.stdout.trim()) return null;
  return { rel: r.stdout.trim() };
}

// ---------------------------------------------------------------------------
// Manifest + marker.

/// The workspace's file manifest on one machine: {files: {rel: {h, s, m}}}
/// (sha256, bytes, mode) plus count/bytes totals. Excludes regenerables and
/// the marker; symlinks are skipped (v1: none outside excluded dirs in
/// practice). The shell side is POSIX all the way: no find -printf (GNU
/// only), size from wc, mode from whichever stat speaks (GNU -c %a, BSD
/// -f %Lp — tried in that order, empty when neither, files then land 644).
/// sha256 of the given files under root on one machine, as {rel: hash}
/// (the hasher chain is tried per command, never per platform — see the
/// header comment). Batches of 200 per exec.
async function hashRels(machine, root, rels) {
  const out = {};
  for (let i = 0; i < rels.length; i += 200) {
    const batch = rels.slice(i, i + 200).map(shellQuote).join(" ");
    const h = await exec("sh", ["-c",
      'cd "$1" && if command -v sha256sum >/dev/null 2>&1; then sha256sum ' + batch + ";"
      + ' elif command -v gsha256sum >/dev/null 2>&1; then gsha256sum ' + batch + ";"
      + ' elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ' + batch + ";"
      + ' else echo "no sha256 hasher found" >&2; exit 127; fi',
      "sh", root], { on: machine });
    if (h.code !== 0) throw new Error("could not hash the workspace (" + (h.stderr || "exit " + h.code) + ")");
    for (const line of h.stdout.split("\n")) {
      const m = line.match(/^([0-9a-f]{64})\s+(?:\.\/)?(.+)$/);
      if (m) out[m[2]] = m[1];
    }
  }
  return out;
}

export async function buildManifest(machine, root) {
  const names = [MARKER].concat(EXCLUDE).map(n => "-name " + shellQuote(n)).join(" -o ");
  const list = 'for f do printf "%s\\t%s\\t%s\\n" "${f#./}" "$(wc -c < "$f")"'
    + ' "$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f" 2>/dev/null)"; done';
  const r = await exec("sh", ["-c",
    'cd "$1" && find . \\( ' + names + ' \\) -prune -o -type f'
    + ' -exec sh -c ' + shellQuote(list) + ' sh {} + | sort',
    "sh", root], { on: machine });
  if (r.code !== 0) throw new Error("could not list the workspace (" + (r.stderr || "exit " + r.code) + ")");
  const files = {};
  let bytes = 0;
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    const [rel, size, mode] = line.split("\t");
    if (!rel || size === undefined) continue;
    files[rel] = { s: Number(size) || 0, m: mode ?? "" };
    bytes += Number(size) || 0;
  }
  const rels = Object.keys(files);
  const hashes = await hashRels(machine, root, rels);
  for (const rel of rels) files[rel].h = hashes[rel];
  return { files, count: rels.length, bytes };
}

/// Determinism the model should not own: after a transfer, re-hash the
/// copied files ON THE TARGET and compare with the source manifest — the
/// resumed agent then finds an integrity that was checked by the tool, not
/// one it has to establish itself against the marker.
export async function verifyCopied(machine, root, manifest, plan) {
  const got = await hashRels(machine, root, plan.copy);
  let bad = 0;
  for (const rel of plan.copy)
    if (got[rel] !== manifest.files[rel]?.h) bad++;
  if (bad) throw new Error(bad + " of " + plan.copy.length + " copied files fail their sha256 on the target");
}

/// The manifest shape stored in a marker: rel → hash only.
export function markerManifest(manifest) {
  const out = {};
  for (const [rel, meta] of Object.entries(manifest.files)) out[rel] = meta.h;
  return out;
}

/// Read the lineage marker in a dir on one machine (null when absent/bad).
/// dir is absolute on that machine.
export async function readMarker(machine, dir) {
  let text = null;
  try { text = await readTextFile(dir + "/" + MARKER, { on: machine }); } catch { return null; }
  try {
    const m = JSON.parse(text ?? "");
    return m && typeof m === "object" && typeof m.id === "string" ? m : null;
  } catch { return null; }
}

/// Stamp the marker (create or update). Text rides chunked printf appends —
/// writeTextFile is local-only (no {on} in the API) and a big lineage's
/// manifest outgrows one argv anyway.
export async function writeMarker(machine, dir, marker) {
  await writeTextChunked(machine, dir + "/" + MARKER, JSON.stringify(marker));
}

/// The three-branch gate for one candidate target dir on one machine:
/// {ok: true, kind: "fresh" | "resume", marker?} or {ok: false, reason}.
/// expectId: the lineage id when this continues an established lineage
/// (null on a first move — only an empty dir is acceptable then).
export async function targetGate(machine, dir, expectId) {
  const probe = await exec("sh", ["-c",
    '[ -d "$1" ] || { echo nofile; exit 0; };'
    + ' [ -w "$1" ] || { echo nowrite; exit 0; };'
    + ' [ -z "$(ls -A "$1")" ] && { echo empty; exit 0; };'
    + ' echo full',
    "sh", dir], { on: machine });
  const state = probe.stdout.trim();
  if (state === "nofile") return { ok: false, reason: "no such directory" };
  if (state === "nowrite") return { ok: false, reason: "not writable" };
  if (state === "empty") return { ok: true, kind: "fresh" };
  if (probe.code !== 0) return { ok: false, reason: "could not inspect (" + (probe.stderr || "exit " + probe.code) + ")" };
  const marker = await readMarker(machine, dir);
  if (!marker) return { ok: false, reason: "not empty and no copy marker" };
  if (expectId && marker.id !== expectId)
    return { ok: false, reason: "holds a different workspace's marker" };
  if (!expectId)
    return { ok: false, reason: "not empty — a first copy needs an empty directory" };
  return { ok: true, kind: "resume", marker };
}

/// What a transfer must do: copy (changed + added), delete (vanished, gated
/// by the target's stored manifest), keep (identical).
export function transferPlan(srcManifest, targetMarker) {
  const copy = [], del = [];
  let keep = 0;
  const old = targetMarker?.manifest ?? {};
  for (const [rel, meta] of Object.entries(srcManifest.files))
    if (old[rel] === meta.h) keep++; else copy.push(rel);
  for (const rel of Object.keys(old)) if (!(rel in srcManifest.files)) del.push(rel);
  return { copy, del, keep };
}

// ---------------------------------------------------------------------------
// Transfer. Every payload rides base64 argv chunks; decode-appends stay
// aligned because chunk sizes are multiples of 4.

/// Which base64 decode flag a machine's base64 speaks, probed once per
/// machine and cached: GNU/busybox accept -d, BSD traditionally only -D.
/// Detection is by trying, never by platform name (a brew-installed GNU
/// coreutils on macOS answers -d; stock BSD answers -D).
const B64D = {};
async function b64dFlag(machine) {
  const key = machine ?? "";
  if (key in B64D) return B64D[key];
  let flag = "-d";
  for (const f of ["-d", "-D"]) {
    const t = await exec("sh", ["-c", 'printf %s aGk= | base64 ' + f + ' >/dev/null 2>&1 && printf ok'], { on: machine });
    if (t.code === 0 && t.stdout.trim() === "ok") { flag = f; break; }
  }
  B64D[key] = flag;
  return flag;
}

/// Read one file on a machine as base64 (null when unreadable). path is
/// absolute on that machine (or $HOME-relative — the shell expands it).
/// Plain `base64 < file` everywhere — no -w0 (GNU only): whatever wrapping
/// the platform inserts is stripped here, so chunk slicing stays aligned.
async function readB64(machine, path) {
  const r = await exec("sh", ["-c", 'base64 < "$1"', "sh", path], { on: machine });
  return r.code === 0 ? r.stdout.replace(/\s+/g, "") : null;
}

/// Write base64 content to one file on a machine (mkdir -p its dir, restore
/// a non-default mode after).
async function writeB64(machine, path, b64, mode) {
  const dflag = await b64dFlag(machine);
  for (let i = 0; i === 0 || i < b64.length; i += CHUNK) {
    const chunk = b64.slice(i, i + CHUNK);
    const r = await exec("sh", ["-c",
      'd=${1%/*}; [ "$d" = "$1" ] || mkdir -p "$d";'
      + ' printf %s "$2" | base64 ' + dflag + ' ' + (i === 0 ? ">" : ">>") + ' "$1"',
      "sh", path, chunk], { on: machine });
    if (r.code !== 0) throw new Error("write failed: " + path + " (" + (r.stderr || "exit " + r.code) + ")");
  }
  if (mode && mode !== "644")
    await exec("sh", ["-c", 'chmod "$2" "$1"', "sh", path, mode], { on: machine });
}

/// Write text to one file on a machine in quoted chunks (any bytes except
/// NUL; JSON transcripts qualify). 64KB keeps the quoted argv well under
/// MAX_ARG_STRLEN even with doubling escapes.
async function writeTextChunked(machine, path, text) {
  for (let i = 0; i === 0 || i < text.length; i += 64 * 1024) {
    const r = await exec("sh", ["-c",
      'd=${1%/*}; [ "$d" = "$1" ] || mkdir -p "$d";'
      + ' printf %s ' + shellQuote(text.slice(i, i + 64 * 1024)) + (i === 0 ? ">" : ">>") + ' "$1"',
      "sh", path], { on: machine });
    if (r.code !== 0) throw new Error("write failed: " + path + " (" + (r.stderr || "exit " + r.code) + ")");
  }
}

/// Round trips cost far more than bytes on this channel — each file pays a
/// read exec plus write execs — so a plan past either threshold travels as
/// ONE tarball: tar on the source (argv-safe batches, appended), raw dd
/// chunk reads, the same base64 argv chunks, untar on the target (tar
/// carries the modes). Small deltas stay per-file: two changed files beat
/// tar+untar setup. Either way onProgress(done, total) ticks.
const PACK_FILES = 16;
const PACK_BYTES = 512 * 1024;
const RAW = 96 * 1024;

/// Whether a plan wants the packed path (a policy seam, exported for tests).
export function planWantsPack(manifest, plan) {
  let bytes = 0;
  for (const rel of plan.copy) bytes += manifest.files[rel]?.s ?? 0;
  return plan.copy.length > PACK_FILES || bytes > PACK_BYTES;
}

const TMPD = {};
async function tmpdir(machine) {
  if (!(machine in TMPD))
    TMPD[machine] = (await exec("sh", ["-c", 'printf %s "${TMPDIR:-/tmp}"'], { on: machine })).stdout.trim() || "/tmp";
  return TMPD[machine];
}

/// The pack artifact's path on one machine: deterministic, keyed by the
/// source root's slug — stable across runs and recoverable from the staged
/// state alone (no in-memory id), which is what makes a canceled run's
/// leftovers findable.
export async function packPath(machine, key) {
  return (await tmpdir(machine)) + "/.herdr-pack-" + key;
}

/// Remove pack artifacts on BOTH ends (best effort, never throws). Called
/// at the re-entry points after a possible strand — the armed click that
/// opens the dialog and the start of go() — and by runPacked's own finally
/// while the run is still alive. Both names are swept on both machines:
/// which end a machine played is not recoverable after the fact.
export async function cleanupPacks(srcMachine, dstMachine, key) {
  for (const m of [srcMachine, dstMachine])
    try {
      const dir = await tmpdir(m);
      await exec("sh", ["-c", 'rm -f "$1" "$2"', "sh", dir + "/.herdr-pack-" + key, dir + "/.herdr-pack-" + key + ".in"], { on: m });
    } catch { /* best effort */ }
}

async function packFrom(machine, tmp, root, rels) {
  const batch = 500;
  for (let i = 0; i < rels.length; i += batch) {
    // $@ spans every positional arg, $1/$2 included — lift them out first
    // or tar packs the pack file and the root by full path (measured: it
    // did; the same trap as excludedPresent's loop).
    // COPYFILE_DISABLE: a macOS source's bsdtar smuggles extended
    // attributes into the tarball as AppleDouble ._* members, which GNU
    // tar on the target materializes as real files the manifest never
    // knew (they then pollute the next drift count). GNU tar ignores the
    // variable — tool-try, not platform-naming.
    const r = await exec("sh", ["-c",
      'p1=$1; p2=$2; shift 2; COPYFILE_DISABLE=1 tar ' + (i === 0 ? "c" : "r") + 'f "$p1" -C "$p2" "$@" && echo ok',
      "sh", tmp, root, ...rels.slice(i, i + batch)], { on: machine });
    if (r.code !== 0 || r.stdout.trim() !== "ok")
      throw new Error("could not pack the workspace (" + (r.stderr || "exit " + r.code) + ")");
  }
}

/// Remove AppleDouble droppings a macOS source's tar may have left:
/// ._X goes only when X is in this manifest and ._X itself is not — a
/// source file genuinely named ._X (SMB/exFAT carry-overs) is real data
/// and stays. Best effort, never throws.
async function sweepAppleDouble(machine, root, manifest) {
  try {
    const list = await exec("sh", ["-c",
      'find "$1" -name "._*" -type f | sed "s|^$1/||"', "sh", root], { on: machine });
    // The prefix lives on the BASENAME (droppings nest: d/._f0), and the
    // pair key keeps its directory: d/._f0 pairs with d/f0.
    const bad = list.stdout.split("\n").filter(rel => {
      const cut = rel.lastIndexOf("/") + 1;
      const base = rel.slice(cut);
      return base.startsWith("._") && base.length > 2
        && manifest.files[rel.slice(0, cut) + base.slice(2)] !== undefined
        && manifest.files[rel] === undefined;
    });
    for (let i = 0; i < bad.length; i += 500)
      await exec("sh", ["-c", 'cd "$1" && shift && rm -f -- "$@"', "sh", root, ...bad.slice(i, i + 500)], { on: machine });
  } catch { /* best effort */ }
}

async function runPacked(srcMachine, srcRoot, dstMachine, dstRoot, plan, onProgress, manifest) {
  // Deterministic per workspace (the source root's slug), not mktemp-random:
  // a canceled run strands its whole task — nothing of ours executes after —
  // so the cleanup at the re-entry points must be able to find the file by
  // construction, on both machines. tar 'c' on the first batch recreates it,
  // so reuse across runs is safe. The destination end carries an ".in"
  // suffix: the same machine can host both ends of a copy (the local→local
  // test rig), and one shared path would have chunk 0's truncating write
  // destroy the tar chunks 1+ still have to read (measured).
  const key = slugOf(srcRoot);
  const srcTmp = await packPath(srcMachine, key);
  const dstTmp = await packPath(dstMachine, key + ".in");
  if (!srcTmp || !dstTmp) throw new Error("could not create a pack file");
  try {
    await packFrom(srcMachine, srcTmp, srcRoot, plan.copy);
    const size = Number((await exec("sh", ["-c", 'wc -c < "$1"', "sh", srcTmp], { on: srcMachine })).stdout.trim()) || 0;
    const total = Math.max(1, Math.ceil(size / RAW));
    const dflag = await b64dFlag(dstMachine);
    for (let i = 0; i < total; i++) {
      const r = await exec("sh", ["-c",
        'dd if="$1" bs=' + RAW + ' skip="$2" count=1 2>/dev/null | base64',
        "sh", srcTmp, String(i)], { on: srcMachine });
      if (r.code !== 0 || !r.stdout) throw new Error("pack read failed at chunk " + (i + 1));
      // Not writeB64: it truncates on its first slice (one file per call);
      // here only the very first append of the very first chunk may create.
      const b64 = r.stdout.replace(/\s+/g, "");
      for (let j = 0; j === 0 || j < b64.length; j += CHUNK) {
        const w = await exec("sh", ["-c",
          'printf %s "$2" | base64 ' + dflag + ((i === 0 && j === 0) ? " > " : " >> ") + '"$1"',
          "sh", dstTmp, b64.slice(j, j + CHUNK)], { on: dstMachine });
        if (w.code !== 0) throw new Error("pack write failed at chunk " + (i + 1));
      }
      if (onProgress) onProgress(i + 1, total);
    }
    const x = await exec("sh", ["-c", 'tar xf "$1" -C "$2" && echo ok', "sh", dstTmp, dstRoot], { on: dstMachine });
    if (x.code !== 0 || x.stdout.trim() !== "ok")
      throw new Error("could not unpack on the target (" + (x.stderr || "exit " + x.code) + ")");
    await sweepAppleDouble(dstMachine, dstRoot, manifest);
    return plan.copy.length;
  } finally {
    for (const [m, p] of [[srcMachine, srcTmp], [dstMachine, dstTmp]])
      if (p) try { await exec("sh", ["-c", 'rm -f "$1"', "sh", p], { on: m }); } catch { /* best effort */ }
  }
}

/// Run one plan between machines (either may be null = this machine; paths
/// absolute on their side). onProgress(done, total) lets the panel show
/// movement. Returns the number of files copied.
export async function runTransfer(srcMachine, srcRoot, manifest, dstMachine, dstRoot, plan, onProgress) {
  let done = 0;
  if (plan.copy.length && planWantsPack(manifest, plan)) {
    done = await runPacked(srcMachine, srcRoot, dstMachine, dstRoot, plan, onProgress, manifest);
  } else {
    for (const rel of plan.copy) {
      const b64 = await readB64(srcMachine, srcRoot + "/" + rel);
      if (b64 === null) throw new Error("read failed: " + rel);
      await writeB64(dstMachine, dstRoot + "/" + rel, b64, manifest.files[rel]?.m);
      done++;
      if (onProgress) onProgress(done, plan.copy.length);
    }
  }
  if (plan.del.length)
    await exec("sh", ["-c", 'cd "$1" && shift && rm -f -- "$@"', "sh", dstRoot, ...plan.del], { on: dstMachine });
  return done;
}

// ---------------------------------------------------------------------------
// Session placement + resume args.

/// Place a claude session on the target machine for the target workspace:
/// the transcript (and its checkpoint side dir, file by file) into the
/// target's slug dir. Session comes from findClaudeSession on the source.
export async function placeClaudeSession(srcMachine, session, dstMachine, dstRoot) {
  const dstDir = (await machineHome(dstMachine)) + "/.claude/projects/" + slugOf(dstRoot);
  await exec("sh", ["-c", 'mkdir -p "$1"', "sh", dstDir], { on: dstMachine });
  const b64 = await readB64(srcMachine, session.dir + "/" + session.uuid + ".jsonl");
  if (b64 === null) throw new Error("read failed: the session transcript");
  await writeB64(dstMachine, dstDir + "/" + session.uuid + ".jsonl", b64);
  if (session.side) {
    const list = await exec("sh", ["-c",
      'd="$1"; find "$d" -type f | sed "s|^$d/||"', "sh", session.dir + "/" + session.uuid],
      { on: srcMachine });
    for (const rel of list.stdout.split("\n").filter(Boolean)) {
      const data = await readB64(srcMachine, session.dir + "/" + session.uuid + "/" + rel);
      if (data !== null) await writeB64(dstMachine, dstDir + "/" + session.uuid + "/" + rel, data);
    }
  }
}

/// Place a codex session on the target: read the rollout as text, rewrite
/// its first line for the target root, write it at the same relative path.
export async function placeCodexSession(srcMachine, session, dstMachine, dstRoot) {
  const text = await readTextFile(session.rel.replace(/^\./, ".codex/sessions"), { on: srcMachine });
  if (text == null) throw new Error("read failed: the session rollout");
  const abs = (await machineHome(dstMachine)) + "/.codex/sessions/" + session.rel.replace(/^\.\//, "");
  await writeTextChunked(dstMachine, abs, recodeCodexMeta(text, dstRoot));
}

/// Rewrite a codex rollout's first line for the target root: cwd and
/// runtime_workspace_roots move; everything else (id included) stays.
export function recodeCodexMeta(rolloutText, dstRoot) {
  const nl = rolloutText.indexOf("\n");
  const head = nl === -1 ? rolloutText : rolloutText.slice(0, nl);
  const rest = nl === -1 ? "" : rolloutText.slice(nl);
  let meta;
  try { meta = JSON.parse(head); } catch { throw new Error("codex session_meta is not JSON"); }
  const payload = meta?.payload && typeof meta.payload === "object" ? meta.payload : meta;
  payload.cwd = dstRoot;
  if (Array.isArray(payload.runtime_workspace_roots)) payload.runtime_workspace_roots = [dstRoot];
  return JSON.stringify(meta) + rest;
}

/// The target machine's platform word for the resume prompt ("linux",
/// "macOS", or the raw uname when unexpected; "" when unprobed). Cached
/// per machine.
const PLAT = {};
export async function targetPlatform(machine) {
  const key = machine ?? "";
  if (key in PLAT) return PLAT[key];
  let word = "";
  try {
    const r = await exec("sh", ["-c", "uname -s 2>/dev/null"], { on: machine === "" ? null : machine });
    const u = r.stdout.trim();
    word = u === "Linux" ? "linux" : u === "Darwin" ? "macOS" : u;
  } catch { word = ""; }
  PLAT[key] = word;
  return word;
}

/// Which excluded regenerables actually exist at the workspace root on the
/// source machine — they stay behind, so the resumed agent should
/// reinstall them. Empty when none, null when the probe failed.
export async function excludedPresent(machine, root) {
  try {
    const r = await exec("sh", ["-c",
      'cd "$1" 2>/dev/null || exit 1; shift;'
      + ' for d do [ -d "$d" ] && printf "%s\\n" "$d"; done; exit 0',
      "sh", root, ...EXCLUDE], { on: machine === "" ? null : machine });
    if (r.code !== 0) return null;
    return r.stdout.split("\n").filter(Boolean);
  } catch { return null; }
}

/// The default first message for the resumed session: convertible context
/// only — the new absolute root (the transcript is dense with old-machine
/// paths), the platform (the command surface changes), the regenerables
/// that stayed behind. Never the herdr machine name: it is renameable and
/// the target agent cannot resolve it to anything.
export function defaultPrompt(dir, platform, excluded) {
  let s = "continue — now at " + dir;
  if (platform) s += " on " + platform;
  if (excluded && excluded.length)
    s += "; " + excluded.join(", ") + " stayed behind — reinstall them there";
  // Name the marker so the resumed agent treats it as expected furniture,
  // not an unknown dotfile to clean: it is load-bearing for later copies.
  s += "; " + MARKER + " is this copy's manifest — keep it, later copies delta by it";
  return s;
}

/// The extra argv that turns a normal provider launch into the resumed one.
/// claude: --resume <uuid> <prompt> (a prompt is required — a bare --resume
/// can refuse on some tail states, measured 2026-11-24). codex: the resume
/// subcommand shape, pending its rig check.
export function resumeArgs(app, id, prompt) {
  const text = String(prompt ?? "").trim() || "continue";
  return app === "codex" ? ["resume", id, text] : ["--resume", id, text];
}

/// The branch name (or short sha when detached) of a workspace on one
/// machine — shell-only, no git binary needed; "" when there is no .git.
/// Deliberately uncached: branches switch between copies, and a stale
/// name in the drift sentence would be worse than the exec it saves.
export async function readGitBranch(machine, root) {
  // A display probe (the dialog's drift sentence): any failure degrades to
  // "unknown branch" — never throws. exec also rejects an {on: ""} machine
  // name, so "" (this machine) is normalized to null before anything runs.
  try {
    const r = await exec("sh", ["-c",
      'h=$(sed -n "s|^ref: refs/heads/||p" "$1/.git/HEAD" 2>/dev/null);'
      + ' [ -n "$h" ] || h=$(cut -c1-7 "$1/.git/HEAD" 2>/dev/null); printf %s "$h"',
      "sh", root], { on: machine === "" ? null : machine });
    return r.code === 0 ? r.stdout.trim() : "";
  } catch { return ""; }
}

/// How far the target drifted from the last copy's baseline: files whose
/// hash no longer matches the marker plus files the marker remembers that
/// are gone. Feeds the confirm dialog's honest sentence — the copy then
/// overwrites them (the parking-spot rule, now said out loud with a count).
export async function countDrift(machine, root, marker) {
  // Same deal as readGitBranch: a number for the drift sentence, 0 when it
  // cannot be told — never throws.
  try {
    const on = machine === "" ? null : machine;
    const rels = Object.keys(marker?.manifest ?? {});
    if (!rels.length) return 0;
    const gone = (await exec("sh", ["-c",
      'cd "$1" 2>/dev/null || exit 0; shift;'
      + ' for f do [ -e "$f" ] || printf "%s\\n" "$f"; done; exit 0',
      "sh", root, ...rels], { on })).stdout.split("\n").filter(Boolean);
    const goneSet = new Set(gone);
    const here = rels.filter(r => !goneSet.has(r));
    const hashes = here.length ? await hashRels(on, root, here) : {};
    let drift = gone.length;
    for (const rel of here) if (hashes[rel] !== marker.manifest[rel]) drift++;
    return drift;
  } catch { return 0; }
}
