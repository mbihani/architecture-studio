/*
 * apply-gate.test.mjs — proves the REAL cause of "I can't see the target
 * architecture after applying AI suggestions", and that M6a fixes it.
 *
 * Root cause: applyAiAccepted() in index.html gates the applied board through
 * storedStateUsable() BEFORE it re-renders:
 *
 *     var next = B.applySuggestionsToBoard(boardSnapshot(), accepted);
 *     if (!storedStateUsable(next)) { toast("...failed validation; nothing applied"); return; }
 *     rememberUndo(); loadBoardSnap(next); persistCustom(); build(); fitBoard();
 *
 * storedStateUsable() requires the applied board to still carry at least 60% of
 * BASE's platform tiles. The OLD applySuggestionsToBoard spliced `remove` tiles
 * out — so a realistic mix that retires several platform SKUs dropped the count
 * under the threshold, the gate returned false, and the canvas was NEVER rebuilt.
 *
 * These are the REAL platformTileCount + storedStateUsable + constants lifted
 * verbatim from index.html (SCHEMA=26, RAIL_IDS, PROVIDER_TILE_KEYS), run against
 * a representative BASE.bands and a reference-like fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureUids, applySuggestionsToBoard } from "../bridge.mjs";

/* ---- constants copied verbatim from index.html ---- */
const SCHEMA = 26;
const RAIL_IDS = ["src", "ing", "ppl", "cons"];
const PROVIDER_TILE_KEYS = ["fed", "ingest", "bi", "identity", "govcat", "aisvc", "cicd", "services"];

/* ---- platformTileCount + storedStateUsable copied verbatim from index.html,
        with BASE injected as a parameter (index.html closes over a module-level
        BASE; the check itself is identical). ---- */
function platformTileCount(bands) {
  let n = 0;
  (bands || []).forEach((b) => (b.rows || []).forEach((r) => {
    if (Array.isArray(r.items)) n += r.items.length;
    if (Array.isArray(r.stages)) n += r.stages.length;
  }));
  return n;
}
function storedStateUsable(s, BASE) {
  if (!s || s.schema !== SCHEMA) return false;
  if (s.industry != null && typeof s.industry !== "string") return false;
  if (!Array.isArray(s.bands) || !s.bands.length) return false;
  if (platformTileCount(s.bands) < platformTileCount(BASE.bands) * 0.6) return false;
  if (!s.rails || RAIL_IDS.some((id) => !s.rails[id] || !Array.isArray(s.rails[id].groups))) return false;
  if (!s.top || !Array.isArray(s.top.secs) || !s.top.secs.every((x) => Array.isArray(x.tiles))) return false;
  if (!s.cloud || !Array.isArray(s.cloud.extras)) return false;
  const provs = s.cloud.providers;
  if (!provs || !Object.keys(provs).length) return false;
  return Object.values(provs).every((p) => PROVIDER_TILE_KEYS.every((k) => Array.isArray(p[k])));
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---- fixtures ---- */

// A band whose single cards row holds one tile per name.
function platBand(id, name, names) {
  return { id, name, tone: "a", rows: [{ kind: "cards", items: names.map((n) => ({ n, ic: "product", long: n })) }] };
}

// A representative reference-like BASE with 20 platform tiles across bands.
// storedStateUsable's gate is >= 60% of this => 12 platform tiles required.
function baseBoard() {
  return {
    schema: SCHEMA,
    industry: "generic",
    bands: [
      platBand("data", "Agentic Data", ["Delta Lake", "Lakehouse", "Unity Catalog", "AI Search", "Lakebase", "Iceberg", "Delta Sharing", "Model Serving"]),
      platBand("gov", "Governance", ["Governance", "Audit Logs", "Lineage", "ABAC", "Data Quality", "MLflow"]),
      platBand("serve", "Serve", ["SQL Warehouses", "Genie", "AI Gateway", "Agent Bricks", "Apps", "Feature Store"]),
    ],
    rails: railScaffold(),
    top: { name: "Use Cases", secs: [{ title: "Business Use Cases", tiles: [{ n: "Customer 360" }] }] },
    cloud: cloudScaffold(),
  };
}

function railScaffold() {
  return {
    src: { id: "src", name: "Sources", groups: [{ box: "Structured", tiles: [{ n: "Operational Databases" }] }] },
    ing: { id: "ing", name: "3rd Party", groups: [{ box: "3rd Party", tiles: [{ n: "Legacy ETL" }] }] },
    ppl: { id: "ppl", name: "Teams", groups: [{ box: "Business", tiles: [{ n: "Executives" }] }] },
    cons: { id: "cons", name: "Consumers", groups: [{ box: "BI", tiles: [{ n: "Power BI" }] }] },
  };
}
function cloudScaffold() {
  return {
    name: "Cloud",
    extras: [{ n: "dbt & External Engines" }],
    providers: {
      azure: { label: "Azure", fed: [{ n: "Synapse" }], ingest: [], bi: [], identity: [], govcat: [], aisvc: [], cicd: [], services: [] },
    },
  };
}

// A reference-like customer board with 14 platform tiles (>= the 12 gate on its
// own), rails with groups, top.secs with tiles, cloud.extras + a full provider.
function customerBoard() {
  return {
    schema: SCHEMA,
    industry: "banking",
    bands: [
      platBand("data", "Agentic Data", ["Delta Lake", "Lakehouse", "Unity Catalog", "AI Search", "Lakebase", "Iceberg"]),
      platBand("gov", "Governance", ["Governance", "Audit Logs", "Lineage", "MLflow"]),
      platBand("serve", "Serve", ["SQL Warehouses", "Genie", "Feature Store", "Standalone Batch Scoring"]),
    ],
    rails: railScaffold(),
    top: { name: "Use Cases", secs: [{ title: "Business Use Cases", tiles: [{ n: "Real-time Fraud" }] }] },
    cloud: cloudScaffold(),
  };
}

/* ---- tests ---- */

test("the customer board is valid on its own (sanity)", () => {
  const BASE = baseBoard();
  assert.equal(platformTileCount(BASE.bands), 20);
  assert.equal(platformTileCount(customerBoard().bands), 14);
  assert.ok(storedStateUsable(customerBoard(), BASE), "the reference-like fixture should pass the gate");
});

// A realistic modernization mix: recommend existing SKUs, add new sources/
// consumers, retune one platform tile, and RETIRE several platform SKUs.
function modernizationSuggestions() {
  return [
    { action: "add", component: "Unity Catalog", category: "platform", reason: "already have — govern everything", priority: "high" },
    { action: "add", component: "Lakeflow Connect", component_id: null, category: "platform", reason: "managed CDC", setup_notes: "Configure Lakeflow Connect", priority: "high" },
    { action: "add", component: "Kafka Topic (collections)", component_id: null, category: "source", reason: "streaming source", priority: "high" },
    { action: "add", component: "Regulator Portal", component_id: null, category: "consumer", reason: "RBI reporting", priority: "medium" },
    { action: "modify", component: "Genie", modifications: ["Curate collections datasets"], reason: "self-serve", priority: "medium" },
    // retire redundant platform SKUs (these MATCH platform tiles on the board)
    { action: "remove", component: "Feature Store", reason: "consolidate onto UC", priority: "high" },
    { action: "remove", component: "Standalone Batch Scoring", reason: "replace with Model Serving", priority: "high" },
    { action: "remove", component: "Iceberg", reason: "standardize on Delta", priority: "medium" },
    { action: "remove", component: "Lineage", reason: "covered by UC lineage", priority: "low" },
  ];
}

test("applied board STILL passes the real storedStateUsable (M6a fix)", () => {
  const BASE = baseBoard();
  const applied = applySuggestionsToBoard(customerBoard(), modernizationSuggestions());

  // The whole point: apply must produce a board the studio's gate accepts, so
  // applyAiAccepted() proceeds to build()+fitBoard() and the canvas re-renders.
  assert.ok(storedStateUsable(applied, BASE),
    "applied board must satisfy storedStateUsable so the canvas re-renders");

  // remove => mark, not splice: every retired platform tile is still present.
  const names = [];
  applied.bands.forEach((b) => b.rows.forEach((r) => (r.items || []).forEach((t) => names.push(t.n))));
  ["Feature Store", "Standalone Batch Scoring", "Iceberg", "Lineage"].forEach((n) => {
    assert.ok(names.includes(n), `${n} must be kept on the board (marked retiring)`);
    const tile = findTileByName(applied, n);
    assert.equal(tile._aiState, "remove", `${n} should be marked _aiState:"remove"`);
  });

  // The platform count did not drop (it grew by the one net-new platform add).
  assert.ok(platformTileCount(applied.bands) >= platformTileCount(customerBoard().bands),
    "marking (not splicing) removes must not reduce the platform tile count");
});

test("REPRODUCE: the OLD splice-on-remove behavior dropped the board below the gate", () => {
  const BASE = baseBoard();
  const applied = applySuggestionsToBoard(customerBoard(), modernizationSuggestions());

  // Simulate what the previous implementation did: splice out every tile that a
  // remove suggestion matched (now visible as _aiState:"remove").
  const oldBehavior = clone(applied);
  oldBehavior.bands.forEach((b) => b.rows.forEach((r) => {
    if (Array.isArray(r.items)) r.items = r.items.filter((t) => t._aiState !== "remove");
  }));

  // 14 platform tiles + 1 net-new platform - 4 platform removes = 11 < 12 (60% of 20).
  assert.equal(platformTileCount(oldBehavior.bands), 11);
  assert.ok(!storedStateUsable(oldBehavior, BASE),
    "splicing the removes drops below the 60% gate => 'nothing applied' (the bug)");
});

test("net-new tiles carry a real ICONS glyph, never an undefined ic", () => {
  const applied = applySuggestionsToBoard(customerBoard(), modernizationSuggestions());
  const netNew = [];
  applied.bands.forEach((b) => b.rows.forEach((r) => (r.items || []).forEach((t) => { if (t._net_new) netNew.push(t); })));
  RAIL_IDS.forEach((z) => (applied.rails[z].groups || []).forEach((g) => (g.tiles || []).forEach((t) => { if (t._net_new) netNew.push(t); })));
  assert.ok(netNew.length >= 1, "expected at least one net-new tile");
  netNew.forEach((t) => assert.equal(t.ic, "product", "net-new tiles get a valid ICONS key"));
});

function findTileByName(board, name) {
  let found = null;
  board.bands.forEach((b) => b.rows.forEach((r) => (r.items || []).forEach((t) => { if (t.n === name) found = t; })));
  return found;
}
