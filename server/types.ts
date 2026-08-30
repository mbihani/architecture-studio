// ---------------------------------------------------------------------------
// Backend-local TypeScript types.
//
// The frontend (src/types/index.ts) and backend keep their own copies of the
// shared data-model types so each TS project (tsconfig.app.json /
// server/tsconfig.json) is self-contained under project references.
//
// The ArchitectureDoc family (Component, Edge, Industry, …) is retained for
// semantic modelling; the draw.io integration surfaces industries via the
// mxfile XML, so Industry's non-essential fields are optional.
// ---------------------------------------------------------------------------

// --- ArchitectureDoc (semantic format) ------------------------------------

export type ComponentCategory =
  | "platform"
  | "source"
  | "ingestion"
  | "consumer"
  | "usecase"
  | "cloud";

export type Zone = "platform" | "src" | "ing" | "ppl" | "cons" | "top" | "cloud";

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

/** An industry overlay selecting a subset of components. */
export interface Industry {
  id: string;
  label: string;
  /** Short description — omitted when the industry is parsed from a draw.io diagram name. */
  blurb?: string;
  /** Component IDs — omitted when the industry is parsed from a draw.io diagram name. */
  componentIds?: string[];
  /** Medallion layers — omitted when the industry is parsed from a draw.io diagram name. */
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
}
