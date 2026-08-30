// ---------------------------------------------------------------------------
// Shared TypeScript types for Architecture Studio.
//
// The app embeds the diagrams.net (draw.io) editor via an iframe + the
// postMessage protocol. The backend serves a draw.io mxfile XML; the frontend
// loads it into the editor and persists edits back. No OAuth, no API keys.
// ---------------------------------------------------------------------------

// --- ArchitectureDoc (semantic format, retained for modelling) ------------

/** Component category, matching Amr's SVG dictionary groups. */
export type ComponentCategory =
  | "platform"
  | "source"
  | "ingestion"
  | "consumer"
  | "usecase"
  | "cloud";

/** Layout zone on the architecture canvas. */
export type Zone =
  | "platform"
  | "src"
  | "ing"
  | "ppl"
  | "cons"
  | "top"
  | "cloud";

/** A directional data-out descriptor for a component. */
export interface DataFlow {
  types: string[];
  vol: string;
  interval: string;
}

export interface DataOut {
  batch?: DataFlow;
  stream?: DataFlow;
}

export interface Component {
  id: string;
  name: string;
  shortName: string;
  category: ComponentCategory;
  icon: string;
  zone: Zone;
  description: string;
  capabilities: string[];
  relatedIds: string[];
  dataOut?: DataOut;
  cite: string[];
  what: string;
  users: string;
  kpis: string[];
  teams: string[];
}

export type EdgeKind = "flow" | "related" | "feeds" | "uses";

export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
}

export interface MedallionLayer {
  s: string;
  long: string;
}

export interface Medallion {
  Bronze: MedallionLayer;
  Silver: MedallionLayer;
  Gold: MedallionLayer;
}

/** An industry overlay. When parsed from a draw.io diagram name, only id + label are populated. */
export interface Industry {
  id: string;
  label: string;
  blurb?: string;
  componentIds?: string[];
  medallion?: Medallion;
}

export interface ArchitectureDoc {
  version: 1;
  components: Component[];
  edges: Edge[];
  industries: Industry[];
}

// --- draw.io API response shapes -----------------------------------------

/** Response from GET /api/architecture. */
export interface ArchitectureResponse {
  /** The full mxfile XML with all diagram pages. */
  drawioXml: string;
}

/** Request body for POST /api/architecture. */
export interface SaveArchitectureRequest {
  drawioXml: string;
}

/** Response from POST /api/architecture. */
export interface SaveArchitectureResponse {
  saved: boolean;
}

/** Response from POST /api/industries/:id/activate. */
export interface ActivateIndustryResponse {
  id: string;
  activated: boolean;
  /** A single-page mxfile XML containing only the selected industry's diagram. */
  drawioXml: string;
}
