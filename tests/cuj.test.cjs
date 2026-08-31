"use strict";
/* Comprehensive Critical-User-Journey suite for the Architecture Studio edit
   surface. Tests the pure-logic mirror in ./model-core.cjs (which mirrors the
   inline <script> blocks of index.html) plus a structural contract test that
   greps index.html for the production-readiness tokens. No npm dependencies:
   only node:test, node:assert and node:fs. Run with: node --test tests/ */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./model-core.cjs");

const RAIL_IDS = core.RAIL_IDS;
const group = (box, ...names) => ({ box, ic:"folder", tiles: names.map(n => ({ n })) });

/* A round-trip-safe provider: every PROVIDER_TILE_KEYS slot is an array, so the
   fixture survives exportJSON -> importJSON -> storedStateUsable. */
function fullProvider(){ const p = {}; core.PROVIDER_TILE_KEYS.forEach(k => p[k] = []); return p; }

function fixture(industry){
  const rails = Object.fromEntries(RAIL_IDS.map(id => [id, { name:id, groups:[group(id + " group", id + " A", id + " B")] }]));
  return { industry: industry || "generic", bands:[{ rows:[] }], rails,
    top:{ secs:[] }, cloud:{ providers:{ aws: fullProvider() }, extras:[] }, _customFlows:[] };
}
const industries = (id, rails) => ({ [id]: { rails } });
const store = () => new Map();

/* =========================================================================
   CUJ 1 — Select a reference architecture (industry tab switching)
   ========================================================================= */
describe("CUJ 1: industry switching", () => {
  test("switching overlays industry rails and records the industry id", () => {
    const base = fixture(), state = core.clone(base);
    core.applyIndustry(state, base, industries("retail", { src:[group("Retail", "POS")] }), "retail");
    assert.equal(state.industry, "retail");
    assert.deepEqual(state.rails.src.groups[0].tiles.map(t => t.n), ["POS"]);
  });

  test("A -> B -> A lands on the pristine board every time (never the live tree)", () => {
    const base = fixture(), state = core.clone(base);
    const ind = { retail:{ rails:{ src:[group("Retail","POS")] } }, finance:{ rails:{ cons:[group("BI","Risk")] } } };
    core.applyIndustry(state, base, ind, "retail");
    state.rails.src.groups[0].tiles.push({ n:"mutated" });
    core.applyIndustry(state, base, ind, "finance");
    core.applyIndustry(state, base, ind, "retail");
    assert.deepEqual(state.rails.src.groups[0].tiles.map(t => t.n), ["POS"]);
    assert.ok(!state.rails.src.groups[0].tiles.some(t => t.n === "mutated"));
  });

  test("switching clears a zone _deleted flag carried from a previous view", () => {
    const base = fixture(), state = core.clone(base);
    state.rails.ing._deleted = true;
    core.applyIndustry(state, base, {}, "generic");
    assert.equal(state.rails.ing._deleted, undefined);
  });

  test("switching resets custom flows (an overlay belongs to one board)", () => {
    const base = fixture(), state = core.clone(base);
    state._customFlows = [{ from:"src A", to:"cons A", label:"" }];
    core.applyIndustry(state, base, {}, "generic");
    assert.deepEqual(state._customFlows, []);
  });

  test("an unknown industry id falls back to generic", () => {
    const base = fixture(), state = core.clone(base);
    core.applyIndustry(state, base, {}, "does-not-exist");
    assert.equal(state.industry, "generic");
  });
});

/* =========================================================================
   CUJ 2 — Modify architecture (add/delete components, groups, zones)
   ========================================================================= */
describe("CUJ 2: modify architecture", () => {
  test("add a component to a group", () => {
    const state = fixture();
    const g = state.rails.src.groups[0];
    const v = core.validateComponentName("Lakeflow Connect");
    assert.equal(v.ok, true);
    g.tiles.push({ n: v.name });
    assert.ok(core.buildSummary(state).src.includes("Lakeflow Connect"));
  });

  test("delete a single atom by name", () => {
    const state = fixture();
    core.bulkDelete(state, [{ type:"atom", zone:"src", gidx:0, name:"src A" }]);
    assert.deepEqual(core.buildSummary(state).src, ["src B"]);
  });

  test("delete a group removes it and its atoms", () => {
    const state = fixture();
    state.rails.src.groups.push(group("second", "X", "Y"));
    core.bulkDelete(state, [{ type:"group", zone:"src", gidx:1 }]);
    assert.equal(state.rails.src.groups.length, 1);
    assert.equal(state.rails.src.groups[0].box, "src group");
  });

  test("delete a zone empties groups and flags _deleted", () => {
    const state = fixture();
    core.deleteZone(state, "ppl");
    assert.equal(state.rails.ppl.groups.length, 0);
    assert.equal(state.rails.ppl._deleted, true);
  });

  test("edit a component name rejects empty", () => {
    assert.equal(core.validateComponentName("").ok, false);
    assert.equal(core.validateComponentName("   ").ok, false);
    assert.equal(core.validateComponentName("Valid").ok, true);
  });
});

/* =========================================================================
   CUJ 3 — Canvas isolation (edits don't affect reference architectures)
   ========================================================================= */
describe("CUJ 3: canvas isolation", () => {
  test("applyIndustry never mutates BASE", () => {
    const base = fixture(), before = core.clone(base), state = core.clone(base);
    core.applyIndustry(state, base, industries("retail", { src:[group("Retail","POS")] }), "retail");
    state.rails.src.groups[0].tiles.push({ n:"extra" });
    core.applyIndustry(state, base, {}, "generic");
    assert.deepEqual(base, before);
  });

  test("applyIndustry never mutates the INDUSTRIES overlay", () => {
    const base = fixture(), ind = industries("retail", { src:[group("Retail","POS")] });
    const before = core.clone(ind), state = core.clone(base);
    core.applyIndustry(state, base, ind, "retail");
    state.rails.src.groups[0].tiles.pop();
    assert.deepEqual(ind, before);
  });

  test("persisting an edit does not leak back into BASE", () => {
    const base = fixture(), state = core.clone(base), s = store();
    state.rails.src.groups[0].tiles.push({ n:"Client Feature" });
    core.persistCustom(s, "canvas", state);
    const restored = fixture();
    assert.equal(core.loadCustom(s, "canvas", restored), true);
    assert.ok(core.buildSummary(restored).src.includes("Client Feature"));
    assert.ok(!core.buildSummary(base).src.includes("Client Feature"));
  });

  test("two independent canvases do not cross-contaminate", () => {
    const base = fixture(), a = core.clone(base), b = core.clone(base), s = store();
    a.rails.src.groups[0].tiles.push({ n:"A-only" });
    b.rails.cons.groups[0].tiles.push({ n:"B-only" });
    core.persistCustom(s, "a", a); core.persistCustom(s, "b", b);
    const ra = fixture(), rb = fixture();
    core.loadCustom(s, "a", ra); core.loadCustom(s, "b", rb);
    assert.ok(core.buildSummary(ra).src.includes("A-only"));
    assert.ok(!core.buildSummary(ra).cons.includes("B-only"));
    assert.ok(core.buildSummary(rb).cons.includes("B-only"));
    assert.ok(!core.buildSummary(rb).src.includes("A-only"));
  });
});

/* =========================================================================
   CUJ 4 — Multi-select and bulk delete
   ========================================================================= */
describe("CUJ 4: multi-select and bulk delete", () => {
  test("allSelectable enumerates every group and atom across non-deleted zones", () => {
    const state = fixture();
    state.rails.src.groups.push(group("second", "X"));
    const items = core.allSelectable(state);
    const types = items.reduce((m, i) => (m[i.type] = (m[i.type]||0)+1, m), {});
    // 4 base zones * 2 atoms = 8 atoms, +1 extra atom from the second src group
    assert.equal(types.atom, 9);
    // the second src group has a tile so it isn't selected as a group
    assert.equal(types.group || 0, 0);
  });

  test("allSelectable selects an empty group as a group (no atoms to select)", () => {
    const state = fixture();
    state.rails.src.groups.push(group("empty"));
    const items = core.allSelectable(state);
    assert.ok(items.some(i => i.type === "group" && i.zone === "src" && i.name === "empty"));
  });

  test("allSelectable skips deleted zones", () => {
    const state = fixture();
    core.deleteZone(state, "ppl");
    const items = core.allSelectable(state);
    assert.equal(items.filter(i => i.zone === "ppl").length, 0);
    assert.ok(items.some(i => i.zone === "src"));
  });

  test("select-all then bulk-delete empties every zone", () => {
    const state = fixture();
    state.rails.src.groups.push(group("second", "X"));
    core.bulkDelete(state, core.allSelectable(state));
    RAIL_IDS.forEach(zid => assert.equal(core.buildSummary(state)[zid].length, 0));
  });

  test("bulk delete removes child atoms before groups (no index drift)", () => {
    const state = fixture();
    state.rails.src.groups.push(group("second", "X"), group("third", "Y"));
    core.bulkDelete(state, [
      { type:"atom", zone:"src", gidx:0, name:"src A" },
      { type:"group", zone:"src", gidx:1 },
      { type:"group", zone:"src", gidx:2 },
    ]);
    assert.deepEqual(core.buildSummary(state).src, ["src B"]);
  });

  test("bulk delete with no items is a no-op", () => {
    const state = fixture(), before = core.clone(state);
    core.bulkDelete(state, []);
    assert.deepEqual(state, before);
  });
});

/* =========================================================================
   CUJ 5 — Zone-level deletion (entire box removal)
   ========================================================================= */
describe("CUJ 5: zone-level deletion", () => {
  test("deleteZone empties groups and marks _deleted", () => {
    const state = fixture();
    core.deleteZone(state, "cons");
    assert.equal(state.rails.cons.groups.length, 0);
    assert.equal(state.rails.cons._deleted, true);
  });

  test("hideDeletedZones hides only deleted zones", () => {
    const state = fixture();
    const els = Object.fromEntries(RAIL_IDS.map(id => [id, { display:"" }]));
    core.deleteZone(state, "ing");
    core.hideDeletedZones(state, els);
    assert.equal(els.ing.display, "none");
    RAIL_IDS.filter(id => id !== "ing").forEach(id => assert.equal(els[id].display, ""));
  });

  test("a deleted zone reappears after an industry switch", () => {
    const base = fixture(), state = core.clone(base);
    core.deleteZone(state, "src");
    assert.equal(state.rails.src._deleted, true);
    core.applyIndustry(state, base, {}, "generic");
    assert.equal(state.rails.src._deleted, undefined);
    assert.ok(state.rails.src.groups.length > 0);
  });

  test("emptyStateMessage flags a visible empty zone but not a deleted one", () => {
    const state = fixture();
    assert.equal(core.emptyStateMessage(state, "src"), null);
    core.deleteZone(state, "src");
    assert.equal(core.emptyStateMessage(state, "src"), null);           // deleted -> hidden, not stated
    state.rails.ing.groups = []; state.rails.ing._deleted = false;       // emptied without deleting
    assert.ok(core.emptyStateMessage(state, "ing"));                    // visible empty -> message
  });
});

/* =========================================================================
   CUJ 6 — Custom flow creation and persistence
   ========================================================================= */
describe("CUJ 6: custom flows", () => {
  test("snapshot carries _customFlows", () => {
    const state = fixture();
    state._customFlows.push({ from:"src A", to:"cons A", label:"serves" });
    const snap = core.snapshot(state);
    assert.equal(snap._customFlows.length, 1);
    assert.equal(snap._customFlows[0].label, "serves");
  });

  test("persist/load round-trip preserves flows", () => {
    const state = fixture(), s = store();
    state._customFlows.push({ from:"src A", to:"cons A", label:"" });
    core.persistCustom(s, "c", state);
    const r = fixture();
    core.loadCustom(s, "c", r);
    assert.deepEqual(r._customFlows, state._customFlows);
  });

  test("industry switch clears custom flows", () => {
    const base = fixture(), state = core.clone(base);
    state._customFlows.push({ from:"src A", to:"cons A", label:"" });
    core.applyIndustry(state, base, {}, "generic");
    assert.deepEqual(state._customFlows, []);
  });

  test("a flow referencing a deleted component survives persist/load", () => {
    const state = fixture(), s = store();
    state._customFlows.push({ from:"src A", to:"cons A", label:"" });
    core.persistCustom(s, "c", state);
    const r = fixture();
    core.loadCustom(s, "c", r);
    core.deleteZone(state, "cons");   // delete destination in original
    assert.equal(r._customFlows.length, 1);   // restored copy still holds the flow
  });
});

/* =========================================================================
   CUJ 7 — Component resizing persistence
   ========================================================================= */
describe("CUJ 7: component resizing persistence", () => {
  test("group _w/_h survive snapshot", () => {
    const state = fixture();
    state.rails.src.groups[0]._w = 333; state.rails.src.groups[0]._h = 222;
    const snap = core.snapshot(state);
    assert.equal(snap.rails.src.groups[0]._w, 333);
    assert.equal(snap.rails.src.groups[0]._h, 222);
  });

  test("resize persists across a reload", () => {
    const state = fixture(), s = store();
    state.rails.ing.groups[0]._w = 420;
    core.persistCustom(s, "c", state);
    const r = fixture();
    core.loadCustom(s, "c", r);
    assert.equal(r.rails.ing.groups[0]._w, 420);
  });

  test("an un-resized group has no _w/_h after round-trip", () => {
    const state = fixture(), s = store();
    core.persistCustom(s, "c", state);
    const r = fixture();
    core.loadCustom(s, "c", r);
    assert.equal(r.rails.ppl.groups[0]._w, undefined);
    assert.equal(r.rails.ppl.groups[0]._h, undefined);
  });
});

/* =========================================================================
   CUJ 8 — Export / Import JSON round-trip
   ========================================================================= */
describe("CUJ 8: export/import JSON", () => {
  test("exportJSON produces pretty JSON with the schema stamp", () => {
    const state = fixture();
    const json = core.exportJSON(state);
    const parsed = JSON.parse(json);
    assert.equal(parsed.schema, core.SCHEMA);
    assert.ok(json.includes("\n"));   // pretty-printed
  });

  test("export -> import is an identity for the model fields", () => {
    const state = fixture();
    state.rails.src.groups[0]._w = 300;
    state._customFlows.push({ from:"src A", to:"cons A", label:"x" });
    state.industry = "retail";
    const restored = fixture();
    assert.equal(core.importJSON(core.exportJSON(state), restored).ok, true);
    assert.equal(restored.industry, "retail");
    assert.equal(restored.rails.src.groups[0]._w, 300);
    assert.deepEqual(restored._customFlows, state._customFlows);
    assert.deepEqual(core.buildSummary(restored), core.buildSummary(state));
  });

  test("import rejects non-string input", () => {
    const state = fixture();
    assert.equal(core.importJSON(null, state).ok, false);
    assert.equal(core.importJSON(123, state).ok, false);
    assert.equal(core.importJSON(undefined, state).ok, false);
  });

  test("import rejects malformed JSON", () => {
    const state = fixture();
    const r = core.importJSON("{not json", state);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid-json");
  });

  test("import rejects a wrong-schema payload", () => {
    const state = fixture();
    const snap = core.snapshot(state); snap.schema = 1;
    const r = core.importJSON(JSON.stringify(snap), state);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid-structure");
  });

  test("import rejects a payload missing rails", () => {
    const state = fixture();
    const r = core.importJSON(JSON.stringify({ schema: core.SCHEMA, bands:[{}], top:{secs:[]}, cloud:{providers:{},extras:[]} }), state);
    assert.equal(r.ok, false);
  });

  test("import rejects an empty object", () => {
    const state = fixture();
    assert.equal(core.importJSON("{}", state).ok, false);
  });

  test("a failed import leaves the canvas untouched", () => {
    const state = fixture();
    const before = core.clone(state);
    core.importJSON("garbage", state);
    assert.deepEqual(state, before);
  });
});

/* =========================================================================
   CUJ 9 — Edge cases: empty states, invalid input, concurrent edits, undo
   ========================================================================= */
describe("CUJ 9: edge cases", () => {
  test("groupEmpty detects a tile-less group", () => {
    assert.equal(core.groupEmpty(group("x")), true);
    assert.equal(core.groupEmpty(group("x", "a")), false);
    assert.equal(core.groupEmpty(null), true);
  });

  test("buildSummary tolerates a zone with no groups key", () => {
    const state = fixture();
    state.rails.ppl.groups = undefined;
    assert.deepEqual(core.buildSummary(state).ppl, []);
  });

  test("buildSummary tolerates a group with no tiles", () => {
    const state = fixture();
    state.rails.ing.groups = [group("empty")];
    assert.deepEqual(core.buildSummary(state).ing, []);
  });
});

describe("validation: New Box name", () => {
  test("empty name is rejected", () => {
    const state = fixture();
    assert.equal(core.validateBoxName(state, "src", "").ok, false);
    assert.equal(core.validateBoxName(state, "src", "   ").ok, false);
  });
  test("duplicate name within the same zone is rejected", () => {
    const state = fixture();
    const dup = core.validateBoxName(state, "src", "src group");
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, "duplicate");
  });
  test("the same name in a different zone is allowed", () => {
    const state = fixture();
    assert.equal(core.validateBoxName(state, "ing", "src group").ok, true);
  });
  test("control characters and markup are stripped before uniqueness", () => {
    const state = fixture();
    // "<src group>" sanitizes to "src group", which is a duplicate
    const v = core.validateBoxName(state, "src", "<src group>");
    assert.equal(v.ok, false);
    assert.equal(v.reason, "duplicate");
    // a clean unique name passes
    assert.equal(core.validateBoxName(state, "src", "Brand New Box").ok, true);
  });
});

describe("undo stack", () => {
  test("push then undo restores the prior state", () => {
    const state = fixture(), undo = core.makeUndo();
    undo.push(state);
    state.rails.src.groups = [];
    assert.ok(undo.undo(state));
    assert.equal(state.rails.src.groups.length, 1);
  });
  test("undo on an empty stack returns false and is a no-op", () => {
    const state = fixture(), undo = core.makeUndo();
    const before = core.clone(state);
    assert.equal(undo.undo(state), false);
    assert.deepEqual(state, before);
  });
  test("multiple undos step back one at a time", () => {
    const state = fixture(), undo = core.makeUndo();
    undo.push(state);                                   // snapshot S0
    state.rails.src.groups[0].tiles.push({ n:"first" });
    undo.push(state);                                   // snapshot S1
    state.rails.src.groups[0].tiles.push({ n:"second" });
    undo.undo(state); assert.ok(core.buildSummary(state).src.includes("first"));
    assert.ok(!core.buildSummary(state).src.includes("second"));
    undo.undo(state); assert.ok(!core.buildSummary(state).src.includes("first"));
  });
  test("the stack is capped at the limit", () => {
    const state = fixture(), undo = core.makeUndo(3);
    for (let i = 0; i < 10; i++){ undo.push(state); }
    assert.equal(undo.size(), 3);
  });
  test("clear empties the stack (industry-switch semantics)", () => {
    const state = fixture(), undo = core.makeUndo();
    undo.push(state); undo.push(state);
    undo.clear();
    assert.equal(undo.size(), 0);
    assert.equal(undo.undo(state), false);
  });
  test("undo restores _customFlows too", () => {
    const state = fixture(), undo = core.makeUndo();
    undo.push(state);
    state._customFlows.push({ from:"src A", to:"cons A", label:"" });
    undo.undo(state);
    assert.deepEqual(state._customFlows, []);
  });
});

/* =========================================================================
   Structural contract: index.html retains the production-readiness surface
   ========================================================================= */
describe("index.html production-readiness contracts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  // original edit-surface contracts (kept from the prior suite)
  ["function build()", "function applyIndustry", "function persistCustom",
   "function hideDeletedZones", "_customFlows", "multiSelection", "resize-handle"]
    .forEach(token => test(`retains edit-surface token: ${token}`, () => {
      assert.ok(html.includes(token), `missing: ${token}`);
    }));

  // production-readiness additions
  ["setAttribute(\"role\",\"toolbar\")", "aria-label=\"Toggle edit mode\"",
   "aria-label=\"Delete the selected item or items\"",
   "aria-label=\"Export the current canvas as a JSON file\"",
   "aria-label=\"Import a canvas from a JSON file\"",
   "var undoStack = [];", "function undoOnce()", "rememberUndo()",
   "exportBtn.onclick", "importFile.onchange",
   "setAttribute(\"role\",\"alert\")", "zone-empty", "updateEmptyStates",
   "already exists in this zone", "Component name cannot be empty",
   "e.key === \"Delete\"", "e.key.toLowerCase() === \"z\"", "e.key.toLowerCase() === \"a\""]
    .forEach(token => test(`retains production token: ${token}`, () => {
      assert.ok(html.includes(token), `missing: ${token}`);
    }));

  test("modal carries dialog + aria-modal roles", () => {
    assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'));
  });

  test("the import path validates via storedStateUsable", () => {
    assert.ok(/importFile\.onchange[\s\S]*storedStateUsable/.test(html));
  });
});
