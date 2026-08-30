// ---------------------------------------------------------------------------
// In-memory draw.io XML architecture store.
//
// On startup the store loads the architecture mxfile from (in order):
//   1. data/architecture.drawio     — the last-saved edited state (if any)
//   2. converter/sample-output/architecture.drawio — the seed file generated
//      by converter/json_to_drawio.py from the normalised ArchitectureDoc.
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
/** Last-saved edited XML, if present this takes priority over the seed. */
const SAVED_FILE = path.join(DATA_DIR, "architecture.drawio");
/** Seed file produced by the converter (converter/json_to_drawio.py). */
const SEED_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "converter",
  "sample-output",
  "architecture.drawio",
);

/** Minimal mxfile used when neither the saved file nor the seed exists. */
const EMPTY_MXFILE =
  '<mxfile host="Architecture Studio" version="24.0.0">\n</mxfile>';

let architectureXml = loadInitialXml();

/** Load the architecture XML from disk at startup (saved file → seed → empty). */
function loadInitialXml(): string {
  if (existsSync(SAVED_FILE)) {
    return readFileSync(SAVED_FILE, "utf-8");
  }
  if (existsSync(SEED_FILE)) {
    return readFileSync(SEED_FILE, "utf-8");
  }
  return EMPTY_MXFILE;
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

/** Escape a string for safe interpolation into a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/**
 * Extract a single diagram page as a self-contained mxfile XML string.
 *
 * Returns an <mxfile> containing only the requested <diagram>, ready to be
 * loaded into the embed iframe via {action: "load", xml: …}. Returns null
 * when no diagram with the given id exists.
 */
export function getIndustryXml(id: string): string | null {
  const re = new RegExp(
    `<diagram\\s+id="${escapeRegExp(id)}"[^>]*>[\\s\\S]*?</diagram>`,
  );
  const match = architectureXml.match(re);
  if (!match) return null;
  return (
    `<mxfile host="Architecture Studio" version="24.0.0">\n` +
    `  ${match[0]}\n` +
    `</mxfile>`
  );
}
