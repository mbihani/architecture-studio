import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureUids,
  flattenBoardToSemantic,
  buildCardLibrary,
  applySuggestionsToBoard,
  extractionToCurrentState,
} from "../bridge.mjs";

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */

// A small board that exercises every walked location and an edge (rel/comps/feeds).
function fixture() {
  return {
    schema: 26,
    industry: "banking",
    bands: [
      {
        id: "ingest",
        name: "Ingest",
        rows: [{ kind: "cards", items: [
          { n: "Lakeflow Connect", s: "connectors", ic: "connect", long: "Managed connectors", caps2: ["CDC"], rel: ["Delta Lake"] },
        ] }],
      },
      {
        id: "data",
        name: "Agentic Data",
        rows: [{ kind: "cards", items: [
          { n: "Delta Lake", ic: "delta", long: "Open storage", caps: ["ACID"] },
          { n: "Lakehouse", ic: "lakehouse", long: "SQL warehousing", caps: ["SQL"], rel: ["Delta Lake"] },
        ] }],
      },
    ],
    rails: {
      src: { id: "src", name: "Sources", groups: [{ box: "Structured", tiles: [
        { n: "Operational Databases", ic: "db", long: "OLTP", feeds: ["Lakeflow Connect"] },
      ] }] },
      ing: { id: "ing", name: "3rd Party", groups: [{ box: "3rd Party", tiles: [
        { n: "Custom ETL Tool", ic: "etl", long: "Informatica" },
      ] }] },
      ppl: { id: "ppl", name: "Teams", groups: [{ box: "Business", tiles: [
        { n: "Executives", long: "Leadership" },
      ] }] },
      cons: { id: "cons", name: "Consumers", groups: [{ box: "BI", tiles: [
        { n: "Tableau / Qlik", ic: "chart", long: "External BI" },
      ] }] },
    },
    top: { name: "Use Cases", secs: [{ title: "Business Use Cases", tiles: [
      { n: "Fraud & Financial Crime", s: "Real time", comps: ["Lakehouse", "Model Serving"] },
    ] }] },
    cloud: {
      name: "Cloud", extras: [{ n: "dbt & External Engines", s: "Transformation", long: "dbt" }],
      providers: {
        azure: { label: "Azure", fed: [{ n: "Azure Synapse", ic: "fed", long: "Federated DW" }], ingest: [], bi: [], identity: [], govcat: [], aisvc: [], cicd: [], services: [] },
      },
    },
  };
}

function collectUids(board) {
  const uids = [];
  const b = board;
  (b.bands || []).forEach((band) => (band.rows || []).forEach((r) => (r.items || []).forEach((t) => uids.push(t._uid))));
  ["src", "ing", "ppl", "cons"].forEach((z) => (b.rails[z].groups || []).forEach((g) => (g.tiles || []).forEach((t) => uids.push(t._uid))));
  (b.top.secs || []).forEach((s) => (s.tiles || []).forEach((t) => uids.push(t._uid)));
  (b.cloud.extras || []).forEach((t) => uids.push(t._uid));
  Object.values(b.cloud.providers || {}).forEach((p) => Object.values(p).forEach((v) => { if (Array.isArray(v)) v.forEach((t) => uids.push(t._uid)); }));
  return uids;
}

/* ------------------------------------------------------------------ */
/* ensureUids                                                         */
/* ------------------------------------------------------------------ */

test("ensureUids assigns a uid to every tile and does not mutate the input", () => {
  const input = fixture();
  const out = ensureUids(input);
  // input untouched
  assert.equal(input.bands[0].rows[0].items[0]._uid, undefined);
  const uids = collectUids(out);
  assert.ok(uids.length >= 8, `expected >=8 tiles, got ${uids.length}`);
  assert.ok(uids.every((u) => typeof u === "string" && u.length > 0));
  // deterministic slug + zone prefix
  assert.equal(out.bands[0].rows[0].items[0]._uid, "ingest:lakeflow-connect");
  assert.equal(out.rails.src.groups[0].tiles[0]._uid, "src:operational-databases");
  assert.equal(out.top.secs[0].tiles[0]._uid, "top:fraud-financial-crime");
  assert.equal(out.cloud.providers.azure.fed[0]._uid, "cloud:azure-synapse");
});

test("ensureUids uids are unique across the board", () => {
  const uids = collectUids(ensureUids(fixture()));
  assert.equal(new Set(uids).size, uids.length);
});

test("ensureUids is idempotent", () => {
  const once = ensureUids(fixture());
  const twice = ensureUids(once);
  assert.deepEqual(twice, once);
});

test("ensureUids dedupes colliding slugs within a zone", () => {
  const board = {
    schema: 26, industry: "x", bands: [], top: { secs: [] },
    cloud: { extras: [], providers: {} },
    rails: {
      src: { id: "src", groups: [{ box: "g", tiles: [{ n: "Kafka" }, { n: "kafka" }, { n: "KAFKA" }] }] },
      ing: { id: "ing", groups: [] }, ppl: { id: "ppl", groups: [] }, cons: { id: "cons", groups: [] },
    },
  };
  const out = ensureUids(board);
  const tiles = out.rails.src.groups[0].tiles;
  assert.deepEqual(tiles.map((t) => t._uid), ["src:kafka", "src:kafka-2", "src:kafka-3"]);
});

/* ------------------------------------------------------------------ */
/* flattenBoardToSemantic                                             */
/* ------------------------------------------------------------------ */

test("flattenBoardToSemantic maps categories from location", () => {
  const doc = flattenBoardToSemantic(fixture());
  assert.equal(doc.version, 1);
  assert.equal(doc.industry, "banking");
  const catOf = (name) => doc.components.find((c) => c.name === name).category;
  assert.equal(catOf("Lakeflow Connect"), "ingestion"); // ingest band
  assert.equal(catOf("Delta Lake"), "platform");        // data band
  assert.equal(catOf("Operational Databases"), "source"); // src rail
  assert.equal(catOf("Custom ETL Tool"), "ingestion");    // ing rail
  assert.equal(catOf("Executives"), "platform");          // ppl rail
  assert.equal(catOf("Tableau / Qlik"), "consumer");      // cons rail
  assert.equal(catOf("Fraud & Financial Crime"), "usecase"); // top
  assert.equal(catOf("dbt & External Engines"), "cloud");    // cloud extras
  assert.equal(catOf("Azure Synapse"), "cloud");             // provider array
});

test("flattenBoardToSemantic merges caps+caps2 and derives description", () => {
  const doc = flattenBoardToSemantic(fixture());
  const lc = doc.components.find((c) => c.name === "Lakeflow Connect");
  assert.deepEqual(lc.capabilities, ["CDC"]);
  assert.equal(lc.description, "Managed connectors");
  const dl = doc.components.find((c) => c.name === "Delta Lake");
  assert.deepEqual(dl.capabilities, ["ACID"]);
});

test("flattenBoardToSemantic resolves an edge from a rel name reference", () => {
  const doc = flattenBoardToSemantic(fixture());
  const byName = {};
  doc.components.forEach((c) => { byName[c.name] = c.id; });
  // Lakeflow Connect --rel--> Delta Lake
  assert.ok(doc.edges.some((e) => e.sourceId === byName["Lakeflow Connect"] && e.targetId === byName["Delta Lake"] && e.kind === "related"));
  // Operational Databases --feeds--> Lakeflow Connect
  assert.ok(doc.edges.some((e) => e.sourceId === byName["Operational Databases"] && e.targetId === byName["Lakeflow Connect"]));
  // Fraud use case --comps--> Lakehouse (Model Serving is unresolved -> skipped)
  assert.ok(doc.edges.some((e) => e.sourceId === byName["Fraud & Financial Crime"] && e.targetId === byName["Lakehouse"]));
  assert.ok(!doc.edges.some((e) => e.targetId === undefined));
});

/* ------------------------------------------------------------------ */
/* buildCardLibrary                                                   */
/* ------------------------------------------------------------------ */

test("buildCardLibrary dumps every tile with zone/caps/long", () => {
  const lib = buildCardLibrary(fixture());
  assert.ok(lib.length >= 9);
  const card = lib.find((c) => c.n === "Lakeflow Connect");
  assert.equal(card.zone, "ingestion");
  assert.deepEqual(card.caps, ["CDC"]);
  assert.equal(card.long, "Managed connectors");
  assert.ok(lib.every((c) => typeof c.n === "string"));
});

/* ------------------------------------------------------------------ */
/* applySuggestionsToBoard                                            */
/* ------------------------------------------------------------------ */

// Minimal shape check mirroring the studio's storedStateUsable() essentials.
function minimalShapeOk(s) {
  if (!s || s.schema !== 26) return false;
  if (s.industry != null && typeof s.industry !== "string") return false;
  if (!Array.isArray(s.bands) || !s.bands.length) return false;
  if (!s.rails || ["src", "ing", "ppl", "cons"].some((id) => !s.rails[id] || !Array.isArray(s.rails[id].groups))) return false;
  if (!s.top || !Array.isArray(s.top.secs) || !s.top.secs.every((x) => Array.isArray(x.tiles))) return false;
  if (!s.cloud || !Array.isArray(s.cloud.extras)) return false;
  const provs = s.cloud.providers;
  if (!provs || !Object.keys(provs).length) return false;
  return Object.values(provs).every((p) => ["fed", "ingest", "bi", "identity", "govcat", "aisvc", "cicd", "services"].every((k) => Array.isArray(p[k])));
}

test("applySuggestionsToBoard handles add(existing), add(net-new), remove, modify", () => {
  const base = ensureUids(fixture());
  const dlUid = base.bands[1].rows[0].items[0]._uid; // Delta Lake
  const etlUid = base.rails.ing.groups[0].tiles[0]._uid; // Custom ETL Tool

  const suggestions = [
    { action: "add", component: "Delta Lake", component_id: dlUid, category: "platform", reason: "already have", priority: "high" },
    { action: "add", component: "Delta Live Tables", component_id: null, category: "ingestion", reason: "need CDC", setup_notes: "Configure DLT with Kafka source bronze silver gold and more", priority: "high" },
    { action: "remove", component: "Custom ETL Tool", component_id: etlUid, reason: "legacy", priority: "high" },
    { action: "modify", component: "Lakehouse", component_id: null, modifications: ["Enable Lakehouse//RT"], reason: "low latency", priority: "medium" },
  ];

  const out = applySuggestionsToBoard(base, suggestions);
  assert.ok(minimalShapeOk(out), "result must satisfy the minimal shape check");

  // add(existing): Delta Lake flagged
  assert.equal(out.bands[1].rows[0].items.find((t) => t.n === "Delta Lake")._aiState, "add");

  // add(net-new): Delta Live Tables placed into the ingest band, net-new, capped setup note
  const dlt = out.bands[0].rows[0].items.find((t) => t.n === "Delta Live Tables");
  assert.ok(dlt, "net-new DLT tile should be added to the ingest band");
  assert.equal(dlt._aiState, "add");
  assert.equal(dlt._net_new, true);
  assert.ok(dlt._uid && dlt._uid.startsWith("ingestion:"));
  assert.ok(dlt.s.length <= 80);

  // remove (M6a): Custom ETL Tool is KEPT in place and marked as retiring, not spliced.
  const etl = out.rails.ing.groups[0].tiles.find((t) => t.n === "Custom ETL Tool");
  assert.ok(etl, "a removed tile must be kept on the board (diff view)");
  assert.equal(etl._aiState, "remove");

  // modify: Lakehouse long appended with a Target note + flagged
  const lh = out.bands[1].rows[0].items.find((t) => t.n === "Lakehouse");
  assert.equal(lh._aiState, "modify");
  assert.match(lh.long, /Target: Enable Lakehouse\/\/RT/);

  // input board was not mutated
  assert.equal(base.rails.ing.groups[0].tiles.length, 1);
});

test("applySuggestionsToBoard places net-new tiles into the right zones and creates groups when missing", () => {
  // Board with empty source/consumer rails -> apply must create a group.
  const board = {
    schema: 26, industry: "x",
    bands: [{ id: "data", rows: [{ kind: "cards", items: [{ n: "Lakehouse" }] }] }],
    rails: {
      src: { id: "src", groups: [] }, ing: { id: "ing", groups: [] },
      ppl: { id: "ppl", groups: [] }, cons: { id: "cons", groups: [] },
    },
    top: { secs: [] },
    cloud: { extras: [], providers: { aws: { label: "AWS", fed: [], ingest: [], bi: [], identity: [], govcat: [], aisvc: [], cicd: [], services: [] } } },
  };
  const out = applySuggestionsToBoard(board, [
    { action: "add", component: "S3 Landing", component_id: null, category: "source", reason: "raw", priority: "low" },
    { action: "add", component: "Power BI", component_id: null, category: "consumer", reason: "bi", priority: "low" },
    { action: "add", component: "Customer 360", component_id: null, category: "usecase", reason: "uc", priority: "low" },
    { action: "add", component: "Some Cloud Svc", component_id: null, category: "cloud", reason: "svc", priority: "low" },
  ]);
  assert.equal(out.rails.src.groups[0].tiles[0].n, "S3 Landing");
  assert.equal(out.rails.cons.groups[0].tiles[0].n, "Power BI");
  assert.equal(out.top.secs[0].tiles[0].n, "Customer 360");
  assert.ok(out.cloud.extras.some((t) => t.n === "Some Cloud Svc"));
  assert.ok(minimalShapeOk(out));
});

/* ------------------------------------------------------------------ */
/* round-trip stability                                               */
/* ------------------------------------------------------------------ */

test("round-trip flatten -> apply -> flatten keeps _uids stable", () => {
  const withUids = ensureUids(fixture());
  const doc1 = flattenBoardToSemantic(withUids);

  // A modify keeps the tile (and its uid); a net-new adds one new uid.
  const applied = applySuggestionsToBoard(withUids, [
    { action: "modify", component: "Delta Lake", component_id: doc1.components.find((c) => c.name === "Delta Lake").id, modifications: ["Iceberg v3"], priority: "low" },
    { action: "add", component: "AI Search", component_id: null, category: "platform", reason: "retrieval", priority: "low" },
  ]);
  const doc2 = flattenBoardToSemantic(applied);

  const ids1 = new Set(doc1.components.map((c) => c.id));
  const ids2 = new Set(doc2.components.map((c) => c.id));
  // every original uid survives
  for (const id of ids1) assert.ok(ids2.has(id), `uid ${id} should survive the round-trip`);
  // exactly one net-new component id added
  assert.equal(doc2.components.length, doc1.components.length + 1);

  // flattening the applied board twice is stable
  assert.deepEqual(flattenBoardToSemantic(applied), doc2);
});

/* ------------------------------------------------------------------ */
/* extractionToCurrentState                                           */
/* ------------------------------------------------------------------ */

test("extractionToCurrentState returns empty arrays for empty / nullish input", () => {
  assert.deepEqual(extractionToCurrentState({}), { components: [], connections: [] });
  assert.deepEqual(extractionToCurrentState(null), { components: [], connections: [] });
  assert.deepEqual(extractionToCurrentState(undefined), { components: [], connections: [] });
  assert.deepEqual(extractionToCurrentState({ components: [], connections: [] }), { components: [], connections: [] });
});

test("extractionToCurrentState maps a typical vision response and drops empty-name components", () => {
  const resp = {
    components: [
      { name: "Finacle CBS", type: "database", category: "source", description: "Oracle Exadata core banking" },
      { name: "  ", type: "unknown", category: "platform", description: "blank name -> dropped" },
      { name: "Enterprise EDW", category: "platform" },
    ],
    connections: [
      { source: "Finacle CBS", target: "Enterprise EDW", kind: "batch" },
      { source: "Enterprise EDW", target: "AML" },
    ],
    zones: ["ingest", "platform"],
    summary: "Batch EDW pipeline",
  };
  const out = extractionToCurrentState(resp);
  // empty-name component dropped -> 2 remain, only name/category/description kept (type dropped)
  assert.equal(out.components.length, 2);
  assert.deepEqual(out.components[0], { name: "Finacle CBS", category: "source", description: "Oracle Exadata core banking" });
  assert.deepEqual(out.components[1], { name: "Enterprise EDW", category: "platform", description: "" });
  assert.ok(out.components.every((c) => !("type" in c)));
  // connections passed through, normalized to {source,target,kind}
  assert.equal(out.connections.length, 2);
  assert.deepEqual(out.connections[0], { source: "Finacle CBS", target: "Enterprise EDW", kind: "batch" });
  assert.deepEqual(out.connections[1], { source: "Enterprise EDW", target: "AML", kind: "" });
});

test("extractionToCurrentState never throws on malformed input", () => {
  const bad = [
    "not an object", 42, true, [],
    { components: "nope", connections: 5 },
    { components: [null, 3, "x", {}, { name: 7 }], connections: [null, "edge", { source: 1 }] },
    { components: [{ name: "OK" }] },
  ];
  for (const b of bad) {
    assert.doesNotThrow(() => extractionToCurrentState(b));
    const out = extractionToCurrentState(b);
    assert.ok(Array.isArray(out.components) && Array.isArray(out.connections));
  }
  // name coerced from a non-string is still kept when non-empty; {} and {name:7->"7"} behavior:
  const coerced = extractionToCurrentState({ components: [{ name: 7 }, {}] });
  assert.equal(coerced.components.length, 1);
  assert.equal(coerced.components[0].name, "7");
});

/* ------------------------------------------------------------------ */
/* focus mode + reason / replaces stamping                            */
/* ------------------------------------------------------------------ */

// Depth-first find a tile by exact name anywhere on the board (names are unique
// in the fixture), so these assertions don't depend on net-new placement paths.
function findTile(board, name) {
  let found = null;
  const walk = (o) => {
    if (found || o == null || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.n === "string" && o.n === name) { found = o; return; }
    Object.keys(o).forEach((k) => walk(o[k]));
  };
  walk(board);
  return found;
}

test("applySuggestionsToBoard stamps _aiReason and _replaces on applied add/modify tiles", () => {
  const base = ensureUids(fixture());
  const dlUid = base.bands[1].rows[0].items[0]._uid; // Delta Lake
  const out = applySuggestionsToBoard(base, [
    { action: "add", component: "Delta Lake", component_id: dlUid, category: "platform", reason: "already have open storage", replaces: ["Teradata"] },
    { action: "add", component: "Managed Ingestion", component_id: null, category: "ingestion", reason: "managed CDC", replaces: ["Custom ETL Tool"] },
    { action: "modify", component: "Lakehouse", component_id: null, modifications: ["RT"], reason: "low latency serving", replaces: [] },
  ]);
  // add(existing)
  const dl = findTile(out, "Delta Lake");
  assert.equal(dl._aiReason, "already have open storage");
  assert.deepEqual(dl._replaces, ["Teradata"]);
  // add(net-new)
  const nn = findTile(out, "Managed Ingestion");
  assert.ok(nn && nn._net_new === true);
  assert.equal(nn._aiReason, "managed CDC");
  assert.deepEqual(nn._replaces, ["Custom ETL Tool"]);
  // modify (empty replaces -> no _replaces key)
  const lh = findTile(out, "Lakehouse");
  assert.equal(lh._aiReason, "low latency serving");
  assert.equal(lh._replaces, undefined);
});

test("applySuggestionsToBoard greys the existing tile a suggestion replaces", () => {
  const base = ensureUids(fixture());
  const out = applySuggestionsToBoard(base, [
    // net-new that supplants an existing tile the user did NOT separately remove
    { action: "add", component: "Managed Ingestion", component_id: null, category: "ingestion", reason: "x", replaces: ["Custom ETL Tool"] },
  ]);
  const etl = findTile(out, "Custom ETL Tool");
  assert.equal(etl._aiState, "remove");
  // the net-new tile itself is an add, not a remove
  assert.equal(findTile(out, "Managed Ingestion")._aiState, "add");
});

test("a replaced name that is itself an add/modify target is not overwritten to remove", () => {
  const base = ensureUids(fixture());
  const dlUid = base.bands[1].rows[0].items[0]._uid; // Delta Lake
  const out = applySuggestionsToBoard(base, [
    { action: "add", component: "Delta Lake", component_id: dlUid, category: "platform", reason: "keep" },
    { action: "add", component: "Managed Ingestion", component_id: null, category: "ingestion", reason: "x", replaces: ["Delta Lake"] },
  ]);
  // Delta Lake stays "add" (it is a target); the replace mapping must not demote it.
  assert.equal(findTile(out, "Delta Lake")._aiState, "add");
});

test("applySuggestionsToBoard marks focus vs peripheral (AI-touched always focus) and stamps _flowOrder", () => {
  const base = ensureUids(fixture());
  const dlUid = base.bands[1].rows[0].items[0]._uid; // Delta Lake
  // mixed-case flow/focus prove case-insensitive matching
  const out = applySuggestionsToBoard(base, [
    { action: "add", component: "AI Search", component_id: null, category: "platform", reason: "retrieval" }, // net-new
    { action: "add", component: "Delta Lake", component_id: dlUid, category: "platform", reason: "keep" },     // existing, flagged
  ], {
    flow: ["OPERATIONAL DATABASES", "Lakeflow Connect", "lakehouse"],
    focus: ["operational databases", "Lakeflow Connect", "Lakehouse"],
  });
  assert.ok(minimalShapeOk(out), "focus marking must not break the board shape");

  // focus-set members are in focus, not peripheral
  const opdb = findTile(out, "Operational Databases");
  assert.equal(opdb._focus, true);
  assert.equal(opdb._peripheral, undefined);

  // not in focus set and not AI-touched -> peripheral
  const execs = findTile(out, "Executives");
  assert.equal(execs._peripheral, true);
  assert.equal(execs._focus, undefined);

  // AI-touched tiles are always focus even when absent from the focus set
  assert.equal(findTile(out, "AI Search")._focus, true);   // net-new
  assert.equal(findTile(out, "Delta Lake")._focus, true);  // flagged add

  // flow order is 1-based and case-insensitive; off-flow tiles carry none
  assert.equal(opdb._flowOrder, 1);
  assert.equal(findTile(out, "Lakeflow Connect")._flowOrder, 2);
  assert.equal(findTile(out, "Lakehouse")._flowOrder, 3);
  assert.equal(execs._flowOrder, undefined);
});

test("applySuggestionsToBoard leaves focus flags untouched when no focus set is given", () => {
  const base = ensureUids(fixture());
  const dlUid = base.bands[1].rows[0].items[0]._uid;
  const out = applySuggestionsToBoard(base, [
    { action: "add", component: "Delta Lake", component_id: dlUid, category: "platform", reason: "keep" },
  ]);
  const opdb = findTile(out, "Operational Databases");
  assert.equal(opdb._focus, undefined);
  assert.equal(opdb._peripheral, undefined);
  assert.equal(opdb._flowOrder, undefined);
  // backward-compatible: a 2-arg call behaves exactly as before
  const out2 = applySuggestionsToBoard(base, [
    { action: "add", component: "Delta Lake", component_id: dlUid, category: "platform", reason: "keep" },
  ], undefined);
  assert.equal(findTile(out2, "Operational Databases")._focus, undefined);
});

test("bridge functions never throw on empty / malformed boards", () => {
  for (const bad of [null, undefined, {}, { bands: null, rails: null }, { bands: [{}], rails: { src: {} }, top: {}, cloud: {} }]) {
    assert.doesNotThrow(() => ensureUids(bad));
    assert.doesNotThrow(() => flattenBoardToSemantic(bad));
    assert.doesNotThrow(() => buildCardLibrary(bad));
    assert.doesNotThrow(() => applySuggestionsToBoard(bad, [{ action: "add", component: "X", component_id: null, category: "platform" }]));
    // focus opts must also degrade safely on malformed boards
    assert.doesNotThrow(() => applySuggestionsToBoard(bad, [{ action: "add", component: "X", component_id: null, category: "platform", replaces: ["Y"] }], { flow: ["X"], focus: ["X"] }));
  }
});
