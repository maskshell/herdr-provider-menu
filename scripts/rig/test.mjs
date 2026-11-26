// T12 rig — two fake machines (homes A and B), real shells underneath.
// Self-syncing: it copies the LIVE mod sources in before testing, so it can
// never drift from them, and asserts the agent-menu twin of providers.js is
// byte-identical (AC7). Run from anywhere: node scripts/rig/test.mjs
// (no install needed — the herdr shim is vendored under node_modules/).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import { exec, HOMES } from "herdr";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.env.PATH = ROOT + "/bin:" + process.env.PATH; // the codex stub

// --- self-sync: test the live mod sources, never stale copies -----------
{
  const MOD = ROOT + "/../../provider-menu/mods/provider-menu";
  const TWIN = ROOT + "/../../agent-menu/mods/agent-menu";
  fs.copyFileSync(MOD + "/providers.js", ROOT + "/providers.js");
  fs.copyFileSync(MOD + "/migrate.js", ROOT + "/migrate.js");
  fs.copyFileSync(TWIN + "/providers.js", ROOT + "/providers.twin.js");
  const twinDiff = fs.readFileSync(ROOT + "/providers.js").equals(fs.readFileSync(ROOT + "/providers.twin.js"));
  fs.rmSync(ROOT + "/providers.twin.js");
  if (!twinDiff) { console.error("FAIL: agent-menu providers.js is not byte-identical to provider-menu's"); process.exit(1); }
}

// The mod sources exist only after the sync above, so their imports are
// dynamic (static imports would resolve before the copies land).
const {
  slugOf, newId, MARKER, findClaudeSession, findCodexSession,
  buildManifest, markerManifest, readMarker, writeMarker, targetGate,
  transferPlan, runTransfer, placeClaudeSession, placeCodexSession,
  recodeCodexMeta, resumeArgs, targetPlatform, excludedPresent, defaultPrompt,
  planWantsPack, verifyCopied, readGitBranch, countDrift, packPath, cleanupPacks,
} = await import("./migrate.js");

let n = 0;
const ok = (name) => console.log("ok " + ++n + " - " + name);
const A = HOMES.A, B = HOMES.B, L = HOMES[""];
ok("twin: providers.js byte-identical across both packages");

fs.rmSync(`${ROOT}/homeA`, { recursive: true, force: true });
fs.rmSync(`${ROOT}/homeB`, { recursive: true, force: true });
fs.rmSync(`${ROOT}/homeLocal`, { recursive: true, force: true });

// --- pure functions -------------------------------------------------------
assert.equal(slugOf("/home/a/proj"), "-home-a-proj");
assert.equal(slugOf("/home/a/proj/"), "-home-a-proj");
ok("slugOf");
assert.match(newId(), /^hm-/);
ok("newId shape");
assert.deepEqual(resumeArgs("claude", "U", ""), ["--resume", "U", "continue"]);
assert.deepEqual(resumeArgs("codex", "U", "hi there"), ["resume", "U", "hi there"]);
ok("resumeArgs shapes");

// --- session discovery ----------------------------------------------------
const WS = `${ROOT}/wsA`; // source workspace, absolute, machine A via HOME trick
// findClaudeSession uses $HOME on the machine — point A's home fixtures there.
fs.mkdirSync(A + "/.claude/projects/" + slugOf(WS) + "", { recursive: true });
fs.writeFileSync(A + "/.claude/projects/" + slugOf(WS) + "/old.jsonl", '{"old":1}\n');
fs.writeFileSync(A + "/.claude/projects/" + slugOf(WS) + "/live.jsonl", '{"live":1}\n');
fs.utimesSync(A + "/.claude/projects/" + slugOf(WS) + "/old.jsonl", new Date(0), new Date(0));
{
  const s = await findClaudeSession("A", WS);
  assert.equal(s.uuid, "live");
  assert.equal(s.side, false);
  assert.ok(s.dir.includes(".claude/projects/" + slugOf(WS) + ""));
  ok("findClaudeSession newest jsonl");
}
fs.mkdirSync(A + "/.claude/projects/" + slugOf(WS) + "/live", { recursive: true });
fs.writeFileSync(A + "/.claude/projects/" + slugOf(WS) + "/live/ckpt.json", "{}");
{
  const s = await findClaudeSession("A", WS);
  assert.equal(s.side, true);
  ok("findClaudeSession side dir detected");
}

fs.mkdirSync(A + "/.codex/sessions/2026/11/24", { recursive: true });
const codexMeta = JSON.stringify({ timestamp: "t", type: "session_meta", payload: { session_id: "cx1", cwd: WS, runtime_workspace_roots: [WS] } });
fs.writeFileSync(A + "/.codex/sessions/2026/11/24/rollout-a.jsonl", codexMeta + "\n{}\n");
fs.writeFileSync(A + "/.codex/sessions/2026/11/24/rollout-b.jsonl", JSON.stringify({ payload: { cwd: "/elsewhere" } }) + "\n");
fs.utimesSync(A + "/.codex/sessions/2026/11/24/rollout-b.jsonl", new Date(), new Date());
{
  const s = await findCodexSession("A", WS);
  assert.equal(s.rel, "./2026/11/24/rollout-a.jsonl");
  ok("findCodexSession matches cwd, skips others");
}

// --- manifest -------------------------------------------------------------
fs.rmSync(WS, { recursive: true, force: true });
fs.mkdirSync(WS + "/src/deep", { recursive: true });
fs.writeFileSync(WS + "/src/a.txt", "alpha\n");
fs.writeFileSync(WS + "/src/deep/b.bin", Buffer.from([0, 1, 2, 255, 254, 10, 13]));
fs.writeFileSync(WS + "/run.sh", "#!/bin/sh\n", { mode: 0o755 });
fs.writeFileSync(WS + "/" + MARKER, '{"id":"stale"}');
fs.mkdirSync(WS + "/node_modules/pkg", { recursive: true });
fs.writeFileSync(WS + "/node_modules/pkg/junk.js", "junk");
{
  const m = await buildManifest("A", WS);
  assert.equal(m.count, 3);
  assert.ok(m.files["src/a.txt"].h.length === 64);
  assert.equal(m.files["run.sh"].m, "755");
  assert.ok(!("node_modules/pkg/junk.js" in m.files));
  assert.ok(!(MARKER in m.files));
  ok("buildManifest hashes, modes, exclusions, marker out");
}
const manifest = await buildManifest("A", WS);

// --- gate -----------------------------------------------------------------
fs.mkdirSync(`${ROOT}/emptyB`, { recursive: true });
{
  const g = await targetGate("B", `${ROOT}/emptyB`, null);
  assert.deepEqual([g.ok, g.kind], [true, "fresh"]);
  ok("gate: empty dir = fresh");
}
{
  const g = await targetGate("B", `${ROOT}/does-not-exist`, null);
  assert.equal(g.ok, false);
  ok("gate: missing dir refused");
}
fs.mkdirSync(`${ROOT}/fullB`, { recursive: true });
fs.writeFileSync(`${ROOT}/fullB/someone-elses.txt`, "x");
{
  const g = await targetGate("B", `${ROOT}/fullB`, null);
  assert.equal(g.ok, false);
  assert.match(g.reason, /no copy marker/);
  ok("gate: non-empty no marker refused");
}
{
  const g = await targetGate("B", `${ROOT}/fullB`, "hm-lineage");
  assert.equal(g.ok, false);
  assert.match(g.reason, /no copy marker/);
  ok("gate: marker expected but absent refused");
}

// --- marker + plan + transfer end-to-end (A -> B) -------------------------
const id = newId();
await writeMarker("A", WS, { v: 1, id, manifest: markerManifest(manifest) });
{
  const m = await readMarker("A", WS);
  assert.equal(m.id, id);
  assert.equal(m.manifest["src/a.txt"], manifest.files["src/a.txt"].h);
  ok("marker roundtrip on source");
}
{
  const g = await targetGate("A", WS, id);
  assert.deepEqual([g.ok, g.kind], [true, "resume"]);
  ok("gate: matching marker = resume");
}
{
  const g = await targetGate("A", WS, "hm-other");
  assert.equal(g.ok, false);
  assert.match(g.reason, /different workspace/);
  ok("gate: mismatched id refused");
}
const DST = `${ROOT}/wsB`;
fs.mkdirSync(DST, { recursive: true });
const plan = transferPlan(manifest, null);
assert.equal(plan.copy.length, 3);
ok("plan: first copy copies all");
let progress = 0;
const copied = await runTransfer("A", WS, manifest, "B", DST, plan, (d, t) => { progress = d; });
assert.equal(copied, 3);
assert.equal(progress, 3);
{
  const after = await buildManifest("B", DST);
  for (const rel of ["src/a.txt", "src/deep/b.bin", "run.sh"]) {
    assert.equal(after.files[rel].h, manifest.files[rel].h, rel + " hash");
  }
  assert.equal(after.files["run.sh"].m, "755");
  ok("transfer: content + mode byte-identical");
}

// --- delta: change one file, add one, delete one ---------------------------
fs.writeFileSync(WS + "/src/a.txt", "alpha2\n");
fs.writeFileSync(WS + "/src/new.txt", "new");
fs.rmSync(WS + "/run.sh");
const manifest2 = await buildManifest("A", WS);
const plan2 = transferPlan(manifest2, { manifest: markerManifest(manifest) });
assert.deepEqual(plan2.copy.sort(), ["src/a.txt", "src/new.txt"]);
assert.deepEqual(plan2.del, ["run.sh"]);
assert.equal(plan2.keep, 1);
ok("plan: delta = changed+added, delete vanished, keep same");
await runTransfer("A", WS, manifest2, "B", DST, plan2);
await writeMarker("B", DST, { v: 1, id, manifest: markerManifest(manifest2) });
{
  const after = await buildManifest("B", DST);
  assert.equal(after.files["src/a.txt"].h, manifest2.files["src/a.txt"].h);
  assert.ok(!("run.sh" in after.files));
  assert.ok("src/new.txt" in after.files);
  ok("delta transfer applied (delete included)");
}

// --- big file chunking (>1 chunk) -----------------------------------------
fs.rmSync(WS + "/big.bin", { force: true });
await exec("sh", ["-c", 'head -c 300000 /dev/urandom > "$1"', "sh", WS + "/big.bin"], { on: "A" });
{
  const m3 = await buildManifest("A", WS);
  const p3 = transferPlan(m3, { manifest: markerManifest(manifest2) });
  await runTransfer("A", WS, m3, "B", DST, p3);
  const h = await exec("sh", ["-c", 'sha256sum "$1" "$2"', "sh", WS + "/big.bin", DST + "/big.bin"], { on: "A" });
  const [h1, h2] = h.stdout.split("\n").map(l => l.split(" ")[0]);
  assert.equal(h1, h2);
  ok("300KB file survives multi-chunk transfer");
}

// --- session placement ------------------------------------------------------
{
  await placeClaudeSession("A", await findClaudeSession("A", WS), "B", DST);
  const f = B + "/.claude/projects/" + slugOf(DST) + "/live.jsonl";
  assert.equal(fs.readFileSync(f, "utf8"), '{"live":1}\n');
  assert.equal(fs.readFileSync(B + "/.claude/projects/" + slugOf(DST) + "/live/ckpt.json", "utf8"), "{}");
  ok("claude session + side dir placed under target slug");
}
{
  await placeCodexSession("A", await findCodexSession("A", WS), "B", DST);
  const text = fs.readFileSync(B + "/.codex/sessions/2026/11/24/rollout-a.jsonl", "utf8");
  const head = JSON.parse(text.split("\n")[0]);
  assert.equal(head.payload.cwd, DST);
  assert.deepEqual(head.payload.runtime_workspace_roots, [DST]);
  assert.equal(head.payload.session_id, "cx1");
  assert.ok(text.endsWith("\n{}\n"));
  ok("codex rollout recoded (cwd/roots), rest intact");
}
{
  const rec = recodeCodexMeta('{"payload":{"cwd":"/a","keep":1}}\nline2\n', "/b");
  const j = JSON.parse(rec.split("\n")[0]);
  assert.equal(j.payload.cwd, "/b");
  assert.equal(j.payload.keep, 1);
  assert.ok(rec.endsWith("\nline2\n"));
  ok("recodeCodexMeta unit");
}

console.log("\n" + n + " assertions groups passed");

// --- prompt context (Pass 54 addendum 4) ---------------------------------
const MK = "; .herdr-migrated is this copy's manifest — keep it, later copies delta by it";
assert.equal(defaultPrompt("/home/b/proj", "linux", ["node_modules"]),
  "continue — now at /home/b/proj on linux; node_modules stayed behind — reinstall them there" + MK);
assert.equal(defaultPrompt("/x", "", null), "continue — now at /x" + MK);
ok("defaultPrompt shapes");
fs.mkdirSync(WS + "/node_modules/pkg", { recursive: true });
fs.mkdirSync(WS + "/.venv", { recursive: true });
const ep = await excludedPresent(null, WS);
assert.ok(Array.isArray(ep) && ep.includes("node_modules") && ep.includes(".venv") && ep.length === 2, "found both, nothing else: " + JSON.stringify(ep));
ok("excludedPresent finds what stayed behind");
assert.equal(await targetPlatform(null), "linux");
ok("targetPlatform on this machine");

// --- packed transfer (Pass 54 addendum 5) ---------------------------------
{
  const P = `${ROOT}/wsPack`, D = `${ROOT}/wsPackDst`;
  fs.rmSync(P, { recursive: true, force: true }); fs.rmSync(D, { recursive: true, force: true });
  fs.mkdirSync(P + "/d", { recursive: true });
  for (let i = 0; i < 300; i++) fs.writeFileSync(P + "/d/f" + i, "content " + i + "\n");
  fs.writeFileSync(P + "/run.sh", "#!/bin/sh\n"); fs.chmodSync(P + "/run.sh", 0o755);
  const m = await buildManifest(null, P);
  assert.equal(m.count, 301);
  const plan = transferPlan(m, null);
  assert.ok(planWantsPack(m, plan), "301 files want the packed path");
  fs.mkdirSync(D, { recursive: true });
  let ticks = 0;
  const n = await runTransfer(null, P, m, null, D, plan, () => ticks++);
  assert.equal(n, 301);
  assert.equal(fs.readFileSync(D + "/d/f299", "utf8"), "content 299\n");
  assert.equal((fs.statSync(D + "/run.sh").mode & 0o777).toString(8), "755", "mode rides the tar");
  assert.ok(ticks > 0, "progress ticked");
  assert.ok(!fs.readdirSync("/tmp").some(f => f.startsWith(".herdr-pack-")), "temp packs cleaned");
  ok("packed first copy: 300 files, bytes+mode identical, temps gone");
  await verifyCopied(null, D, m, plan);
  ok("verifyCopied passes after a clean packed copy");
  fs.writeFileSync(D + "/d/f7", "tampered\n");
  await assert.rejects(() => verifyCopied(null, D, m, plan), /1 of 301/);
  fs.writeFileSync(D + "/d/f7", "content 7\n");
  ok("verifyCopied catches a tampered file with a count");

  fs.writeFileSync(P + "/d/f0", "changed\n"); fs.writeFileSync(P + "/new.txt", "n\n");
  const m2 = await buildManifest(null, P);
  const plan2 = transferPlan(m2, { manifest: markerManifest(m) });
  assert.equal(plan2.copy.length, 2);
  assert.ok(!planWantsPack(m2, plan2), "small delta stays per-file");
  await runTransfer(null, P, m2, null, D, plan2, null);
  assert.equal(fs.readFileSync(D + "/d/f0", "utf8"), "changed\n");
  assert.equal(fs.readFileSync(D + "/new.txt", "utf8"), "n\n");
  ok("small delta stays per-file and applies");

  fs.rmSync(P + "/d/f150");
  const m3 = await buildManifest(null, P);
  const plan3 = transferPlan(m3, { manifest: markerManifest(m2) });
  assert.ok(plan3.del.includes("d/f150"));
  await runTransfer(null, P, m3, null, D, plan3, null);
  assert.ok(!fs.existsSync(D + "/d/f150"), "delete applied alongside the packed path");
  ok("packed-path plan applies deletes");
}

// --- drift + branch (Pass 54 addendum 6) ----------------------------------
{
  fs.mkdirSync(WS + "/.git", { recursive: true });
  fs.writeFileSync(WS + "/.git/HEAD", "ref: refs/heads/main\n");
  assert.equal(await readGitBranch(null, WS), "main");
  fs.writeFileSync(WS + "/.git/HEAD", "abcdef1234567890\n");
  assert.equal((await readGitBranch(null, WS)).length, 7, "detached → short sha");
  fs.rmSync(WS + "/.git", { recursive: true, force: true });
  assert.equal(await readGitBranch(null, WS), "", "no .git → empty");
  ok("readGitBranch: branch, detached, absent");
}
{
  const P = `${ROOT}/wsDrift`, D = `${ROOT}/wsDriftDst`;
  fs.rmSync(P, { recursive: true, force: true }); fs.rmSync(D, { recursive: true, force: true });
  fs.mkdirSync(P, { recursive: true });
  for (let i = 0; i < 5; i++) fs.writeFileSync(P + "/f" + i, "v0-" + i + "\n");
  const m = await buildManifest(null, P);
  const marker = { v: 1, id: "x", at: 0, manifest: markerManifest(m) };
  fs.mkdirSync(D, { recursive: true });
  await runTransfer(null, P, m, null, D, transferPlan(m, null), null);
  assert.equal(await countDrift(null, D, marker), 0, "clean copy drifts nothing");
  fs.writeFileSync(D + "/f0", "target-edited\n");
  fs.writeFileSync(D + "/f1", "target-edited\n");
  fs.rmSync(D + "/f2");
  assert.equal(await countDrift(null, D, marker), 3, "2 changed + 1 gone");
  ok("countDrift: clean, then 2 edits + 1 delete");
}

// --- probe robustness (增补十四): display probes never throw, "" normalizes ---
{
  // The exact armed-click probe set with a LOCAL target (""-coded), as
  // launch() runs it — on the real app this used to reject and kill the
  // dialog silently.
  const [plat, excl, sb, db, dr] = await Promise.all([
    targetPlatform(""), excludedPresent("", WS),
    readGitBranch("", WS), readGitBranch("", WS),
    countDrift("", WS, undefined),
  ]);
  assert.equal(plat, "linux"); // normalized "" probed the local machine
  assert.equal(dr, 0);
  ok("armed probe set survives a local (\"\") target");
  assert.equal(await readGitBranch("X", WS), ""); // unknown machine → caught
  ok("readGitBranch: rejecting exec → \"\"");
  assert.equal(await countDrift("X", WS, { manifest: { "a.txt": "h0" } }), 0);
  ok("countDrift: rejecting exec → 0");
}

// --- deterministic pack paths + both-ends sweep (addendum 18) ------------
{
  const P2 = `${ROOT}/wsPack2`;
  fs.rmSync(P2, { recursive: true, force: true });
  fs.mkdirSync(P2, { recursive: true });
  fs.writeFileSync(P2 + "/f", "x");
  const key = slugOf(P2);
  const pp = await packPath(null, key);
  assert.ok(pp.startsWith("/tmp/.herdr-pack-"), "deterministic path shape: " + pp);
  fs.writeFileSync(pp, "stale pack");
  await cleanupPacks(null, null, key);
  assert.ok(!fs.existsSync(pp), "sweep removed the artifact");
  ok("packPath deterministic + cleanupPacks sweeps");
}

// --- AppleDouble sweep after a packed copy (addendum 21) -----------------
{
  const P3 = `${ROOT}/wsPack3`, D3 = `${ROOT}/wsPackDst3`;
  fs.rmSync(P3, { recursive: true, force: true }); fs.rmSync(D3, { recursive: true, force: true });
  fs.mkdirSync(P3 + "/d", { recursive: true });
  for (let i = 0; i < 30; i++) fs.writeFileSync(P3 + "/d/f" + i, "v" + i + "\n");
  fs.writeFileSync(P3 + "/._real", "a genuinely-named file\n"); // real source data named ._real
  const m3 = await buildManifest(null, P3);
  fs.mkdirSync(D3, { recursive: true });
  fs.mkdirSync(D3 + "/d", { recursive: true });
  fs.writeFileSync(D3 + "/d/._f0", "dropping");      // pair d/f0 in manifest, d/._f0 not → goes
  fs.writeFileSync(D3 + "/._top", "dropping");        // pair would be "top" — not in manifest → stays
  fs.writeFileSync(D3 + "/._orphan", "dropping");    // pair not in manifest at all → stays (not ours)
  await runTransfer(null, P3, m3, null, D3, transferPlan(m3, null), () => {});
  assert.ok(!fs.existsSync(D3 + "/d/._f0"), "nested dropping d/._f0 removed");
  assert.ok(fs.existsSync(D3 + "/._top"), "root ._top without a manifest pair kept");
  assert.ok(fs.existsSync(D3 + "/._orphan"), "._orphan (no manifest pair) untouched");
  assert.ok(fs.existsSync(D3 + "/._real"), "genuine ._real source file kept");
  ok("AppleDouble sweep: droppings out, real ._ files kept");
}

// --- codex argv: the current provider's plain branch (cc-switch parity) --
{
  const { codexArgv } = await import("./providers.js");
  const CARD = {
    key: "sk-test",
    toml: { model: "'gpt-5.2'" },
    table: { name: "'prov'", base_url: "'https://api.example.com'" },
  };
  const LIVE = [
    "model_provider = 'other'",
    "model = 'other-model'",
    "model_catalog_json = '/Users/x/.codex/cc-switch-model-catalog.json'",
    "profile = 'work'",
    "model_reasoning_effort = 'high'",
    "[model_providers.other]",
    "name = 'other'",
    "base_url = 'https://other.example.com'",
  ].join("\n");
  // non-current: the selected profile / catalog pointer refuse the launch
  assert.throws(() => codexArgv(CARD, LIVE, false), /keeps|profile/);
  ok("codex: a foreign live config refuses a non-current launch");
  // current + same machine: the live file is this provider's own state
  const argv = codexArgv(CARD, LIVE, false, [], null, null, null, true);
  assert(argv.includes("-c") && argv.some(w => w.startsWith("model_provider=")));
  assert(argv.some(w => w === "model='gpt-5.2'"), "the provider's own model rides the overrides");
  ok("codex: the current provider's own live config launches plain");
  // plain keeps the refusal machinery for the cases it must still catch
  assert.throws(() => codexArgv({ ...CARD, toml: {} }, LIVE, false, [], null, null, null, false), /keeps|profile/);
  ok("codex: plain defaults to false — the guard is opt-in from launch");
}

// --- codex catalog synthesis (CS1/CS2, arch-design v4) ---------------------
// RED first: catalogEntry + normalizeBundled are the intended exports.
{
  const prov = await import("./providers.js");
  const CARD = { key: "sk-t", toml: { model: "'gpt-6.2-sol'" }, table: { name: "'p'", base_url: "'https://api.x'" } };
  const OFFICIAL = { models: [{ slug: "gpt-6.2-sol", display_name: "GPT", visibility: "hidden",
    service_tiers: ["priority"], additional_speed_tiers: [{x:1}], availability_nux: {a:1}, upgrade: {b:2},
    use_responses_lite: true, priority: 0, base_instructions: "official preamble",
    supports_reasoning_summaries: true, supports_parallel_tool_calls: true, context_window: 400000, max_context_window: 400000 }] };

  // AC2: official hit = normalized entry + the 9-item mutation list, identical elsewhere
  let e = prov.catalogEntry(CARD, OFFICIAL);
  const row = JSON.parse(e.json).models[0];
  assert.equal(row.slug, "gpt-6.2-sol", "slug <- pinned model (already equal here)");
  assert.equal(row.priority, 1000, "priority <- 1000+0");
  assert.equal(row.visibility, "list");
  assert.deepEqual(row.service_tiers, []);
  assert.deepEqual(row.additional_speed_tiers, []);
  assert.equal(row.availability_nux, null);
  assert.equal(row.upgrade, null);
  assert.equal(row.use_responses_lite, false);
  assert.equal(row.base_instructions, "official preamble", "unmutated field passes through");
  assert.equal(row.context_window, 400000, "no configured window -> official window kept");
  assert.equal(e.degraded, false);
  ok("catalogEntry: official hit applies the mutation list, identical elsewhere");

  // conditional window rewrite: configured window rewrites BOTH window and max
  const CARD2 = { key: "sk-t", toml: { model: "'gpt-6.2-sol'", model_context_window: "1000000" }, table: { name: "'p'", base_url: "'https://x'" } };
  const row2 = JSON.parse(prov.catalogEntry(CARD2, OFFICIAL).json).models[0];
  assert.equal(row2.context_window, 1000000);
  assert.equal(row2.max_context_window, 1000000, "max paired (clamp guard)");
  ok("catalogEntry: configured window rewrites context+max together");

  // AC3: neutral fallback - paired windows from config or 128000, degraded flag
  const e3 = prov.catalogEntry({ ...CARD, toml: { model: "'kimi-k3'" } }, OFFICIAL);
  const r3 = JSON.parse(e3.json).models[0];
  assert.equal(e3.degraded, "model", "a miss with a live probe degrades for the model");
  assert.equal(prov.catalogEntry({ ...CARD, toml: { model: "'kimi-k3'" } }, null).degraded, "probe", "a dead probe degrades for the probe");
  assert.equal(r3.slug, "kimi-k3");
  assert.equal(r3.context_window, 128000);
  assert.equal(r3.max_context_window, 128000, "neutral windows paired");
  assert.equal(r3.use_responses_lite, false);
  assert.ok(!("apply_patch_tool_type" in r3) || r3.apply_patch_tool_type !== "custom", "no freeform apply_patch");
  const e4 = prov.catalogEntry({ ...CARD, toml: { model: "'kimi-k3'", model_context_window: "500000" } }, OFFICIAL);
  const r4 = JSON.parse(e4.json).models[0];
  assert.equal(r4.context_window, 500000); assert.equal(r4.max_context_window, 500000);
  ok("catalogEntry: neutral entry pairs config windows, defaults to 128000");

  // hetero review / alias matching: longest prefix, one namespace level, display_name rule
  const eA = prov.catalogEntry({ ...CARD, toml: { model: "'gpt-6.2-sol-high'" } }, OFFICIAL);
  const rA = JSON.parse(eA.json).models[0];
  assert.equal(rA.slug, "gpt-6.2-sol-high", "prefix alias keeps the pinned slug");
  assert.equal(rA.display_name, "gpt-6.2-sol-high", "alias does not borrow the official display name");
  assert.equal(eA.degraded, false, "a prefix alias is an official hit, not the neutral entry");
  const eN = prov.catalogEntry({ ...CARD, toml: { model: "'openai/gpt-6.2-sol'" } }, OFFICIAL);
  const rN = JSON.parse(eN.json).models[0];
  assert.equal(rN.slug, "openai/gpt-6.2-sol", "one namespace level is stripped for the lookup");
  assert.equal(rN.display_name, "openai/gpt-6.2-sol", "namespace alias does not borrow the display name either");
  assert.equal(prov.catalogEntry({ ...CARD, toml: { model: "'deep/seek/kimi'" } }, OFFICIAL).degraded, "model", "two namespace levels do not resolve");
  ok("catalogEntry: alias matching follows codex's own lookup rule");

  // Pi blocker: with a nested pair, iteration order must not decide —
  // gpt-5-codex-mini resolves to gpt-5-codex (longest), gpt-5-codex to itself.
  {
    const NESTED = { models: [
      { slug: "gpt-5", display_name: "GPT-5", context_window: 272000, base_instructions: "p5" },
      { slug: "gpt-5-codex", display_name: "GPT-5 Codex", context_window: 400000, base_instructions: "p5c" },
    ]};
    const exact = JSON.parse(prov.catalogEntry({ ...CARD, toml: { model: "'gpt-5-codex'" } }, NESTED).json).models[0];
    assert.equal(exact.slug, "gpt-5-codex", "a verbatim nested slug resolves to itself");
    assert.equal(exact.base_instructions, "p5c", "not to the shorter prefix's preamble");
    const mini = JSON.parse(prov.catalogEntry({ ...CARD, toml: { model: "'gpt-5-codex-mini'" } }, NESTED).json).models[0];
    assert.equal(mini.base_instructions, "p5c", "the LONGEST prefix wins, not the first in iteration order");
    assert.equal(mini.context_window, 400000, "and the longest row's window");
  }
  ok("catalogEntry: nested slugs resolve by longest prefix, not order");

  // Pi round: the neutral entry mirrors the reference builder's five inserts;
  // an official row without a numeric context_window floors instead of
  // refusing after the plant.
  {
    const e5 = prov.catalogEntry({ ...CARD, toml: { model: "'kimi-k3'" } }, OFFICIAL);
    const r5 = JSON.parse(e5.json).models[0];
    assert.equal(r5.priority, 1000, "neutral priority mirrors the reference");
    assert.equal(r5.visibility, "list", "neutral visibility mirrors the reference");
    assert.deepEqual(r5.service_tiers, [], "neutral tiers stripped");
    assert.equal(r5.availability_nux, null, "neutral nux stripped");
    const NO_WIN = { models: [{ slug: "gpt-6.2-sol", display_name: "GPT", visibility: "hidden" }] };
    assert.equal(prov.catalogEntry(CARD, NO_WIN).contextWindow, 128000, "a non-numeric official window floors to 128000, never refuses post-plant");
  }
  ok("catalogEntry: neutral five-mutation mirror + official window floor");

  // normalizeBundled: backfill parser-required fields, drop invalid rows, backfillable=hit
  const RAW = { models: [
    { slug: "m1", model_messages: { instructions_template: "own preamble" } }, // required backfilled, instructions from the row's own template
    { slug: "" },                                                               // no slug -> invalid, dropped
    { slug: "m3", supports_reasoning_summaries: true, supports_parallel_tool_calls: false, base_instructions: "y" }, // complete, kept verbatim
    { slug: "m4", base_instructions: "" },                                      // empty string IS a string -> kept as-is (reference copies empty verbatim)
    { slug: "m5" }                                                              // neither instructions form -> dropped, no fabricated preamble
  ]};
  const cat = prov.normalizeBundled(JSON.stringify(RAW));
  assert.equal(cat.models.length, 3, "no-slug and no-instructions rows dropped, the rest kept");
  assert.equal(cat.models[0].supports_parallel_tool_calls, true, "parser-required backfill uses the classic template's TRUE");
  assert.equal(cat.models[0].base_instructions, "own preamble", "instructions come from the row's own template");
  assert.equal(cat.models[2].base_instructions, "", "an empty base_instructions string is kept, not replaced");
  assert.ok(cat.models.every(m => m.slug !== "m5"), "a row with no instructions form is dropped, never given the neutral preamble");
  assert.equal(prov.normalizeBundled("not json"), null);
  assert.equal(prov.normalizeBundled('{"models":[]}'), null, "empty catalog -> null");
  ok("normalizeBundled: classic backfill, own-template instructions, drop invalid, null on garbage/empty");
}

// --- CS3/CS4: pre-spawn staging + gate rewiring + cross-machine refusal ----
{
  const prov = await import("./providers.js");
  const fs2 = await import("node:fs");

  // CS3: stageCatalog plants via .part + rename; content exact; no .part residue
  const body = JSON.stringify({ models: [{ slug: "rig-x", context_window: 1 }] });
  const dest = await prov.stageCatalog("A", "rigtest", body);
  assert.ok(dest.endsWith("/.herdr-codex-catalog-rigtest.json"), dest);
  assert.equal(fs2.readFileSync(dest, "utf8"), body, "staged content exact");
  {
    const tmpD = dest.slice(0, dest.lastIndexOf("/"));
    const base = dest.split("/").pop();
    const residue = fs2.readdirSync(tmpD).filter(f => f.startsWith(base));
    assert.deepEqual(residue, [base], "no part siblings left behind: " + residue);
  }
  ok("stageCatalog: atomic plant, exact content, no .part residue");

  // Pi review: the body rides byte-bounded argv words — a >131KB catalog
  // (past the kernel's per-argument cliff) must still stage byte-exact, and
  // so must a CJK-heavy one whose byte length triples its char length.
  {
    const big = JSON.stringify({ models: [{ slug: "big", base_instructions: "x".repeat(200000) }] });
    const bigDest = await prov.stageCatalog("A", "bigbody", big);
    assert.equal(fs2.readFileSync(bigDest, "utf8"), big, "a 200KB ASCII catalog lands byte-exact via chunked argv");
    fs2.rmSync(bigDest, { force: true });
    const cjk = JSON.stringify({ models: [{ slug: "模型", base_instructions: "长".repeat(60000) }] });
    assert.ok(Buffer.byteLength(cjk) > 131072, "the CJK body really is past the cliff in bytes");
    const cjkDest = await prov.stageCatalog("A", "cjkbody", cjk);
    assert.equal(fs2.readFileSync(cjkDest, "utf8"), cjk, "CJK content lands byte-exact — code points never split");
    fs2.rmSync(cjkDest, { force: true });
  }
  ok("stageCatalog: >131KB ASCII and CJK bodies chunk past the per-argument cliff");

  // hetero review / sticky-TMPDIR DoS: a directory squatting on the dest
  // (POSIX mv would move INTO it and report success) falls back to an
  // unpredictable sibling name — availability instead of an un-removable refusal.
  const tmp0 = (await import("node:child_process")).spawnSync("sh", ["-c", 'printf %s "${TMPDIR:-/tmp}"']).stdout.toString().trim() || "/tmp";
  const squat = tmp0 + "/.herdr-codex-catalog-squat.json";
  fs2.rmSync(squat, { recursive: true, force: true });
  fs2.mkdirSync(squat);
  const plantedSquat = await prov.stageCatalog("A", "squat", body);
  assert.ok(plantedSquat.startsWith(tmp0 + "/.herdr-codex-catalog-squat.blocked."), "falls back to an unpredictable sibling: " + plantedSquat);
  assert.equal(fs2.readFileSync(plantedSquat, "utf8"), body, "content lands at the fallback path");
  assert.ok(fs2.statSync(squat).isDirectory(), "the squatting dir is untouched");
  const litter0 = fs2.readdirSync(tmp0).filter(f => f.startsWith(".herdr-codex-catalog-squat"));
  assert.equal(litter0.length, 2, "exactly the squat dir and the planted file, no part litter: " + litter0);
  fs2.rmSync(squat, { recursive: true });
  fs2.rmSync(plantedSquat, { force: true });
  ok("stageCatalog: occupied dest falls back to an unpredictable sibling, no litter");

  // W6/review N2: an apostrophe in the staged path stays a valid TOML basic string
  const APOS = "/tmp/rig-apos'/.herdr-codex-catalog-x.json";
  const argvA = prov.codexArgv(
    { key: "sk-t", toml: { model: "'m'" }, table: { name: "'p'", base_url: "'https://x'" } },
    "model_catalog_json = '/Users/x/.codex/foreign.json'\n", false, [], null, null, null, false,
    { pointer: APOS, contextWindow: 1 });
  assert(argvA.some(w => w === "model_catalog_json=" + JSON.stringify(APOS)), "JSON-quoted pointer survives an apostrophe");
  ok("N2: apostrophe path rides a TOML basic string, not a broken single-quote literal");

  // CS4: staged pointer overrides the catalog leftover; window rides the entry
  const CARD = { key: "sk-t", toml: { model: "'m'" }, table: { name: "'p'", base_url: "'https://x'" } };
  const LIVE_PTR = "model_catalog_json = '/Users/x/.codex/cc-switch-model-catalog.json'\nmodel_context_window = 900000\n";
  const argv = prov.codexArgv(CARD, LIVE_PTR, false, [], null, null, null, false,
    { pointer: dest, contextWindow: 500000 });
  assert(argv.some(w => w === "model_catalog_json=" + JSON.stringify(dest)), "pointer overrides the leftover");
  assert(argv.some(w => w === "model_context_window=500000"), "window sources from the entry");
  ok("gate: staged catalog + entry window override the leftovers");

  // auto_compact_token_limit keeps refusing even when staged
  const LIVE_AUTO = LIVE_PTR + "model_auto_compact_token_limit = 90000\n";
  assert.throws(() => prov.codexArgv(CARD, LIVE_AUTO, false, [], null, null, null, false,
    { pointer: dest, contextWindow: 500000 }), /keeps/);
  ok("gate: model_auto_compact_token_limit still refuses with a catalog staged");

  // AC5b: a row-carried pointer + cross-machine launch refuses with the dangle sentence
  fs2.mkdirSync(A + "/.codex", { recursive: true });
  fs2.writeFileSync(A + "/.codex/config.toml", "model_provider = 'other'\n");
  const ROWPTR = { current: false, key: "sk-t",
    toml: { model: "'m'", model_catalog_json: "'/home/a/.codex/cat.json'" },
    table: { name: "'p'", base_url: "'https://x'" } };
  await assert.rejects(() => prov.launchArgv(ROWPTR, [], "B", "codex", "A"), /dangle|悬空|cross-machine/);
  ok("launch: row-carried catalog pointer refuses a cross-machine launch");
}

// --- W6/review B1+W3: probe cache keyed by resolution form, no negative caching ---
{
  const prov = await import("./providers.js");
  const realPath = process.env.PATH;
  process.env.PATH = "/nonexistent-rig-path";
  const missPlain = await prov.bundledModels("A", null);            // failure -> null...
  process.env.PATH = realPath;
  const hitPlain = await prov.bundledModels("A", null);             // ...which did NOT cache (W3)
  process.env.PATH = "/nonexistent-rig-path";
  const missRc = await prov.bundledModels("A", { login: true });    // plain hit must not answer for rc (B1)
  process.env.PATH = realPath;
  assert.equal(missPlain, null, "absent codex probes return null");
  assert.ok(hitPlain && hitPlain.models.length > 0, "the failed probe retried and hit the real catalog");
  assert.equal(missRc, null, "the plain-form cache entry does not leak into the rc form");
  ok("bundledModels: no negative caching; plain and rc probes cache independently");
}

// --- AC1 end-to-end: launch() synthesizes + stages + threads the pointer ---
{
  const prov = await import("./providers.js");
  const fs2 = await import("node:fs");
  fs2.mkdirSync(B + "/.codex", { recursive: true });
  fs2.writeFileSync(B + "/.codex/config.toml",
    "model_provider = 'other'\nmodel_catalog_json = '/home/b/.codex/cc-switch-model-catalog.json'\n");
  const CARD = { current: false, name: "Rig Third", key: "sk-t", toml: { model: "'rig-private-model'" },
    table: { name: "'p'", base_url: "'https://x'" } };
  const info = {};
  const argv = await prov.launchArgv(CARD, [], "B", "codex", "B", info);
  assert.equal(info.degraded, "model", "the neutral fallback is reported to the caller with its reason (AC3)");
  const anyOfficial = (await prov.bundledModels("B", null)).models[0].slug;
  const info2 = {};
  await prov.launchArgv({ ...CARD, name: "Rig Official", toml: { model: "'" + anyOfficial + "'" } }, [], "B", "codex", "B", info2);
  assert.equal(info2.degraded, false, "an official hit is not degraded");
  // the nested pair end to end: gpt-5-codex must stage ITS OWN preamble
  {
    const infoN = {};
    const argvN = await prov.launchArgv({ ...CARD, name: "Rig Nested", toml: { model: "'gpt-5-codex'" } }, [], "B", "codex", "B", infoN);
    const flatN = argvN.join(" ");
    const segN = flatN.slice(flatN.indexOf("model_catalog_json=")).split(/\s+/)[0];
    const pathN = segN.replace(/^model_catalog_json=/, "").replace(/["'\\]/g, "");
    assert.equal(JSON.parse(fs2.readFileSync(pathN, "utf8")).models[0].base_instructions, "preamble gpt-5-codex",
      "the verbatim nested slug stages its own entry, not the shorter prefix's");
    assert.equal(infoN.degraded, false);
  }
  const flat = argv.join(" ");
  // the pointer rides a shell-quoted -c word (POSIX '\'' escapes inside the
  // handoff script) — take the word after model_catalog_json= and strip quotes
  const seg = flat.slice(flat.indexOf("model_catalog_json=")).split(/\s+/)[0];
  const stagedPath = seg.replace(/^model_catalog_json=/, "").replace(/["'\\]/g, "");
  assert.ok(stagedPath.startsWith("/"), "argv carries the staged pointer: " + flat.slice(0, 160));
  assert.ok(fs2.existsSync(stagedPath), "the staged catalog file exists at " + stagedPath);
  const staged = JSON.parse(fs2.readFileSync(stagedPath, "utf8"));
  assert.equal(staged.models[0].slug, "rig-private-model", "single-model entry for the pinned model");
  assert.equal(staged.models[0].use_responses_lite, false);
  assert.ok(!flat.includes('"models"'), "catalog JSON never rides the command line");
  ok("AC1: launch synthesizes, stages pre-spawn, threads the pointer end to end");
}
