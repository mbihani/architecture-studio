/*
 * spec.test.mjs — unit tests for boardToSpecMarkdown (M6b spec export).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardToSpecMarkdown } from "../bridge.mjs";

function board() {
  return {
    schema: 26,
    industry: "wealth_management",
    bands: [
      { id: "data", name: "Agentic Data", rows: [{ kind: "cards", items: [
        { n: "Delta Lake", ic: "delta", long: "Open storage", caps: ["ACID"], rel: ["Lakehouse"] },
        { n: "Lakehouse", ic: "lakehouse", long: "SQL warehousing", caps: ["SQL"] },
      ] }] },
    ],
    rails: {
      src: { id: "src", groups: [{ box: "S", tiles: [{ n: "Core Banking", long: "OLTP", feeds: ["Delta Lake"] }] }] },
      ing: { id: "ing", groups: [] }, ppl: { id: "ppl", groups: [] },
      cons: { id: "cons", groups: [{ box: "BI", tiles: [{ n: "Power BI", long: "Dashboards" }] }] },
    },
    top: { secs: [{ title: "UC", tiles: [{ n: "Fraud Detection", comps: ["Lakehouse"] }] }] },
    cloud: { extras: [{ n: "dbt", long: "Transforms" }], providers: {
      azure: { label: "Azure", fed: [], ingest: [], bi: [], identity: [], govcat: [], aisvc: [], cicd: [], services: [] } } },
  };
}

test("boardToSpecMarkdown builds a title, summary, inventory, flows and setup", () => {
  const md = boardToSpecMarkdown(board());

  // Title: industry id is humanised + title-cased.
  assert.match(md, /^# Wealth Management — Target Architecture Spec/);

  // Summary line: total components + per-category counts + a flow count.
  // 5 components: Delta Lake, Lakehouse (platform), Core Banking (source),
  // Power BI (consumer), Fraud Detection (usecase), dbt (cloud) => 6.
  assert.match(md, /\*\*6\*\* components/);
  assert.match(md, /Platform & Governance 2/);
  assert.match(md, /\*\*3\*\* data flows\./); // DeltaLake->Lakehouse, CoreBanking->DeltaLake, Fraud->Lakehouse

  // Sections present.
  assert.match(md, /## Component Inventory/);
  assert.match(md, /### Platform & Governance \(2\)/);
  assert.match(md, /- \*\*Delta Lake\*\* — ACID · Open storage/);
  assert.match(md, /## Data Flows/);
  assert.match(md, /- Delta Lake → Lakehouse \(related\)/);
  assert.match(md, /- Core Banking → Delta Lake \(related\)/);
  assert.match(md, /## Setup Sequence/);

  // Setup sequence is numbered and dependency-ordered: cloud + platform lead.
  const setup = md.slice(md.indexOf("## Setup Sequence"));
  assert.match(setup, /1\. \*\*dbt\*\* _\(Cloud & Integrations\)_/);
  assert.match(setup, /2\. \*\*Delta Lake\*\* _\(Platform & Governance\)_/);
  // consumers/use-cases come after platform + sources.
  const idxPlatform = setup.indexOf("Delta Lake");
  const idxUsecase = setup.indexOf("Fraud Detection");
  assert.ok(idxPlatform < idxUsecase, "platform should be set up before use cases");
});

test("boardToSpecMarkdown degrades gracefully on an empty board", () => {
  const md = boardToSpecMarkdown({ schema: 26, industry: "", bands: [], rails: {}, top: { secs: [] }, cloud: { extras: [], providers: {} } });
  assert.match(md, /^# Generic — Target Architecture Spec/);
  assert.match(md, /\*\*0\*\* components/);
  assert.match(md, /_No components on the board\._/);
  assert.match(md, /_No explicit data flows defined\._/);
  assert.match(md, /_Nothing to set up\._/);
});

test("boardToSpecMarkdown never throws on malformed input", () => {
  for (const bad of [null, undefined, {}, 42, "x", [], { bands: null, rails: null, top: null, cloud: null }]) {
    assert.doesNotThrow(() => boardToSpecMarkdown(bad));
    assert.equal(typeof boardToSpecMarkdown(bad), "string");
  }
});

test("boardToSpecMarkdown reflects an applied AI diff (net-new + retiring tiles listed)", () => {
  // A board that has already been through applySuggestionsToBoard carries
  // _aiState / _net_new tiles; the spec should still list them by name.
  const b = board();
  b.bands[0].rows[0].items.push({ n: "AI Search", ic: "product", long: "Vector retrieval", caps: [], _aiState: "add", _net_new: true });
  b.bands[0].rows[0].items.push({ n: "Legacy Cube", long: "retiring", _aiState: "remove" });
  const md = boardToSpecMarkdown(b);
  assert.match(md, /- \*\*AI Search\*\*/);
  assert.match(md, /- \*\*Legacy Cube\*\*/);
});
