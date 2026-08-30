// ---------------------------------------------------------------------------
// In-memory ArchitectureDoc store.
//
// This is a STUB that holds a small mock architecture so the industries and
// export endpoints are exercisable before the data converter (converter/,
// owned by another worker) is wired in.
//
// TODO: replace this with the real ArchitectureDoc produced by the converter
// (Amr's ARCH + INDUSTRIES data → ArchitectureDoc JSON). The converter service
// will likely load the converted doc from disk and refresh it on demand.
// ---------------------------------------------------------------------------

import type { ArchitectureDoc, Industry } from "../types.ts";

/** A small mock architecture used until the converter output is wired in. */
export const mockArchitectureDoc: ArchitectureDoc = {
  version: 1,
  components: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Unity Catalog",
      shortName: "UC",
      category: "platform",
      icon: "uc",
      zone: "platform",
      description: "Unified governance for all data assets in the lakehouse.",
      capabilities: ["lineage", "access control", "auditing"],
      relatedIds: ["550e8400-e29b-41d4-a716-446655440001"],
      dataOut: {
        batch: { types: ["structured"], vol: "high", interval: "hourly" },
        stream: { types: ["semi-structured"], vol: "med", interval: "realtime" },
      },
      cite: ["uc-docs"],
      what: "Governance, lineage, and access control for data and AI assets.",
      users: "Data platform teams, governance leads",
      kpis: ["policy coverage", "time-to-grant"],
      teams: ["platform"],
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440001",
      name: "Delta Live Tables",
      shortName: "DLT",
      category: "ingestion",
      icon: "dlt",
      zone: "ppl",
      description: "Declarative pipelines for batch and streaming ETL.",
      capabilities: ["pipelines", "expectations", "incremental"],
      relatedIds: ["550e8400-e29b-41d4-a716-446655440000"],
      cite: ["dlt-docs"],
      what: "Build reliable, maintainable data pipelines declaratively.",
      users: "Data engineers",
      kpis: ["pipeline freshness", "expectation pass rate"],
      teams: ["data-eng"],
    },
  ],
  edges: [
    {
      id: "550e8400-e29b-41d4-a716-446655440100",
      sourceId: "550e8400-e29b-41d4-a716-446655440001",
      targetId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "flow",
    },
  ],
  industries: [
    {
      id: "banking",
      label: "Banking",
      blurb: "Core data platform for retail banking and risk analytics.",
      componentIds: [
        "550e8400-e29b-41d4-a716-446655440000",
        "550e8400-e29b-41d4-a716-446655440001",
      ],
      medallion: {
        Bronze: { s: "Raw landing", long: "Raw ingested source data, unchanged." },
        Silver: { s: "Cleansed", long: "Conformed, deduplicated, typed." },
        Gold: { s: "Curated", long: "Business-ready marts and metrics." },
      },
    },
    {
      id: "retail",
      label: "Retail",
      blurb: "Unified commerce analytics and inventory optimization.",
      componentIds: ["550e8400-e29b-41d4-a716-446655440000"],
      medallion: {
        Bronze: { s: "Raw landing", long: "Raw POS and inventory feeds." },
        Silver: { s: "Cleansed", long: "Conformed SKU and store dimensions." },
        Gold: { s: "Curated", long: "Demand and margin marts." },
      },
    },
  ],
};

/** Return the industries from the current architecture document. */
export function getIndustries(): Industry[] {
  return mockArchitectureDoc.industries;
}

/**
 * Activate an industry overlay.
 *
 * TODO: in the real implementation this may create or switch to a Lucid page
 * scoped to the industry's componentIds (see POST /api/industries/:id/activate
 * in ARCHITECTURE.md). For now it just validates the id.
 */
export function activateIndustry(id: string): Industry | undefined {
  return mockArchitectureDoc.industries.find((ind) => ind.id === id);
}
