"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("./model-core.cjs");

const group = (box, ...names) => ({ box, ic:"folder", tiles:names.map(n => ({n})) });
function fixture() {
  const rails = Object.fromEntries(core.RAIL_IDS.map(id => [id, { name:id, groups:[group(id+" group", id+" A", id+" B")] }]));
  return { industry:"generic", bands:[{rows:[]}], rails, top:{secs:[]}, cloud:{providers:{aws:{}},extras:[]}, _customFlows:[] };
}

test("build logic tolerates empty groups and deleted zones", () => {
  const state = fixture(); state.rails.ing.groups = []; core.deleteZone(state, "ppl");
  assert.deepEqual(core.buildSummary(state).ing, []);
  assert.deepEqual(core.buildSummary(state).ppl, []);
});

test("applyIndustry overlays a pristine copy without mutating BASE or INDUSTRIES", () => {
  const base = fixture(), industries = { retail:{rails:{src:[group("Retail", "POS")]}} };
  const beforeBase = core.clone(base), beforeIndustries = core.clone(industries), state = core.clone(base);
  state.rails.src.groups[0].tiles.length = 0;
  core.applyIndustry(state, base, industries, "retail");
  assert.equal(state.rails.src.groups[0].tiles[0].n, "POS");
  assert.deepEqual(base, beforeBase); assert.deepEqual(industries, beforeIndustries);
});

test("persist/load round-trip retains edits, sizes, deleted flags and flows", () => {
  const data = new Map(), state = fixture();
  state.rails.src.groups[0]._w = 333; state.rails.ing._deleted = true;
  state._customFlows.push({from:"src A",to:"cons A",label:""});
  core.persistCustom(data, "canvas", state);
  const restored = fixture(); assert.equal(core.loadCustom(data, "canvas", restored), true);
  assert.equal(restored.rails.src.groups[0]._w, 333); assert.equal(restored.rails.ing._deleted, true);
  assert.deepEqual(restored._customFlows, state._customFlows);
});

test("CUJ: select industry, edit, persist, reload", () => {
  const base = fixture(), state = core.clone(base), data = new Map();
  core.applyIndustry(state, base, {finance:{rails:{cons:[group("BI", "Risk Dashboard")]}}}, "finance");
  state.rails.cons.groups[0].tiles.push({n:"Client Feature"}); core.persistCustom(data, "cuj", state);
  const reload = fixture(); core.loadCustom(data, "cuj", reload);
  assert.equal(reload.industry, "finance"); assert.ok(core.buildSummary(reload).cons.includes("Client Feature"));
});

test("mass delete removes multiple atoms and groups without index drift", () => {
  const state = fixture(); state.rails.src.groups.push(group("second", "X"), group("third", "Y"));
  core.bulkDelete(state, [{type:"atom",zone:"src",gidx:0,name:"src A"},{type:"group",zone:"src",gidx:1},{type:"group",zone:"src",gidx:2}]);
  assert.deepEqual(core.buildSummary(state).src, ["src B"]);
});

test("zone deletion sets _deleted and hideDeletedZones reflects it", () => {
  const state = fixture(), elements = Object.fromEntries(core.RAIL_IDS.map(id => [id, {display:""}]));
  core.deleteZone(state, "ing"); core.hideDeletedZones(state, elements);
  assert.equal(state.rails.ing._deleted, true); assert.equal(elements.ing.display, "none"); assert.equal(elements.src.display, "");
});

test("industry switching discards edits and deleted flags", () => {
  const base = fixture(), state = core.clone(base); state.rails.src._deleted = true; state.rails.src.groups = [];
  core.applyIndustry(state, base, {}, "generic");
  assert.equal(state.rails.src._deleted, undefined); assert.equal(state.rails.src.groups.length, 1);
});

test("index.html retains production edit-surface contracts", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ["function build()", "function applyIndustry", "function persistCustom", "function hideDeletedZones", "_customFlows", "multiSelection", "resize-handle"].forEach(token => assert.ok(html.includes(token), token));
});
