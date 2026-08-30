// ---------------------------------------------------------------------------
// In-memory draw.io XML architecture store.
//
// On startup the store loads the architecture mxfile from (in order):
//   1. data/architecture.drawio — the last-saved edited state (if any)
//   2. a minimal one-page fallback mxfile (see SEED_MXFILE below)
//
// Industries are parsed from the mxfile's <diagram id="…" name="…"> elements
// with a lightweight regex (no XML dependency). The full XML is served to the
// frontend which embeds the diagrams.net editor; saves write back to
// data/architecture.drawio so edits persist across restarts.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Industry } from "../types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory for persisted (user-edited) state. */
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
/** Last-saved edited XML, if present this takes priority over the fallback. */
const SAVED_FILE = path.join(DATA_DIR, "architecture.drawio");

/**
 * Minimal one-page mxfile used when no saved file exists yet. Gives the app a
 * single "Databricks Platform" page to render and edit on a fresh start; the
 * first save persists it to data/architecture.drawio.
 */
const SEED_MXFILE = `<mxfile host="Architecture Studio" version="24.0.0">
  <diagram id="platform" name="Databricks Platform">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

let architectureXml = loadInitialXml();
/** Last activated industry id (session-level bookkeeping). */
let activeIndustryId: string | null = null;

/** Load the architecture XML from disk at startup (saved file → fallback). */
function loadInitialXml(): string {
  if (existsSync(SAVED_FILE)) {
    return readFileSync(SAVED_FILE, "utf-8");
  }
  return SEED_MXFILE;
}

/** Decode the five common HTML entities that appear in diagram name attributes. */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Return the full architecture mxfile XML. */
export function getArchitectureXml(): string {
  return architectureXml;
}

/** Persist the architecture XML to disk and update the in-memory copy. */
export function saveArchitectureXml(xml: string): void {
  architectureXml = xml;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SAVED_FILE, xml, "utf-8");
}

/** Record the active industry id (backend bookkeeping for activation). */
export function activateIndustry(id: string): void {
  activeIndustryId = id;
}

/**
 * Parse the mxfile's <diagram> elements and return them as Industry records.
 *
 * Uses a simple regex over the uncompressed XML — no DOM parser dependency.
 * The diagram's `name` attribute (HTML-entity-decoded) becomes the label.
 */
export function getIndustries(): Industry[] {
  const re = /<diagram\s+id="([^"]+)"\s+name="([^"]+)"/g;
  const industries: Industry[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(architectureXml)) !== null) {
    industries.push({ id: match[1], label: decodeHtmlEntities(match[2]) });
  }
  return industries;
}
