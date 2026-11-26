---
queue_version: v1
frozen_at: 2026-11-25
plan_ref: docs/arch-codex-catalog-synthesis.md
authority_chain:
  - docs/arch-codex-catalog-synthesis.md
status: frozen
---

# Plan Queue — arch-design

FROZEN plan interpretation emitted by blueprint-crafting `freeze`. Read-only for the executor; revise only via the Revision Channel (`status` -> `revising` -> edit + queue_version bump -> `status: frozen`). See parallel-development `references/plan-driven-mode.md`.

## Summary (checkpoint view)

6 item(s). DoD source: docs/arch-codex-catalog-synthesis.md.

## Items

```json
[
  {
    "item_id": "CS1",
    "seq": 1,
    "depends_on": [],
    "dod_ref": "AC2",
    "title": "catalog entry builder (pure, no gate)",
    "scope": "official entry + third-party mutation list (incl. priority + conditional window/max rewrite) + neutral template with paired windows; receives an already-gated route; no IO",
    "source_location": "layering #2",
    "parallel_group": "wave1",
    "blueprint_subset": [],
    "producer": "blueprint-crafting",
    "plan_model_version": "v1"
  },
  {
    "item_id": "CS2",
    "seq": 2,
    "depends_on": [],
    "dod_ref": "AC3",
    "title": "bundled-catalog probe + cache + env parity",
    "scope": "codex debug models --bundled on the launch machine + normalize step (backfill parser-required fields, drop invalid rows; backfillable=hit); resolution env mirrors the launch form (bash -lic under RC); null-fallback; PATH spike",
    "source_location": "layering #3",
    "parallel_group": "wave1",
    "blueprint_subset": [],
    "producer": "blueprint-crafting",
    "plan_model_version": "v1"
  },
  {
    "item_id": "CS3",
    "seq": 3,
    "depends_on": [
      "CS1"
    ],
    "dod_ref": "AC4",
    "title": "pre-spawn staging of the temp catalog",
    "scope": "pre-spawn staging: write .part then atomic-rename to the deterministic $TMPDIR path (exec, handoffFile pattern); refuse + clean .part on failure; all argv forms carry the path only",
    "source_location": "layering #4",
    "open_decisions": [
      {
        "id": "D3",
        "kind": "deferred",
        "resolution": "pre-spawn exec plant, .part + atomic rename to a deterministic path (upstream-evidenced: single unlocked startup read)"
      }
    ],
    "blueprint_subset": [],
    "producer": "blueprint-crafting",
    "plan_model_version": "v1"
  },
  {
    "item_id": "CS4",
    "seq": 4,
    "depends_on": [
      "CS1",
      "CS3"
    ],
    "dod_ref": "AC1, AC5",
    "title": "neutralization-gate rewiring",
    "scope": "catalog leftover synthesizes (responses routes only - the D4 consume point); model_context_window from entry, model_auto_compact_token_limit keeps refusing; row-pointer cross-machine refuses with an honest sentence; exotic profiles keep refusing",
    "source_location": "layering #1",
    "open_decisions": [
      {
        "id": "D4",
        "kind": "deferred",
        "resolution": "responses (explicit or defaulted) only"
      },
      {
        "id": "D5",
        "kind": "deferred",
        "resolution": "split per key: context_window from entry; auto_compact_token_limit keeps refusing (absent from real bundled rows)"
      }
    ],
    "blueprint_subset": [],
    "producer": "blueprint-crafting",
    "plan_model_version": "v1"
  },
  {
    "item_id": "CS5",
    "seq": 5,
    "depends_on": [
      "CS2",
      "CS4"
    ],
    "dod_ref": "AC6, AC7",
    "title": "rig integration + twin sync",
    "scope": "existing 40 groups stay green; new cases cover AC1-AC5 incl. a probe-subcommand stub; provider-menu/agent-menu providers.js byte-identical (diff empty)",
    "source_location": "cross-boundary-contracts",
    "blueprint_subset": [],
    "producer": "blueprint-crafting",
    "plan_model_version": "v1"
  },
  {
    "item_id": "CS6",
    "seq": 6,
    "depends_on": [
      "CS5"
    ],
    "dod_ref": "version-strategy",
    "title": "docs: recipe watch-out, review addendum, template provenance",
    "scope": "RECIPE bullet + REVIEW addendum + MIT attribution comment in the vendored template",
    "source_location": "version-strategy",
    "blueprint_subset": [],
    "producer": "blueprint-crafting",
    "plan_model_version": "v1"
  }
]
```
