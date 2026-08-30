// ---------------------------------------------------------------------------
// Shared TypeScript types for Architecture Studio.
//
// These mirror the data model defined in ARCHITECTURE.md:
//   - ArchitectureDoc JSON  — our semantic format (export + readback)
//   - Lucid Standard Import JSON — Lucid's documented document format
//   - API response shapes for the backend contract
// ---------------------------------------------------------------------------

// --- ArchitectureDoc (our semantic format) ------------------------------

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
  /** Data type tags, e.g. "structured", "semi-structured", "unstructured". */
  types: string[];
  /** Volume class: "low" | "med" | "high". */
  vol: string;
  /** Cadence, e.g. "realtime", "hourly", "daily". */
  interval: string;
}

/** Optional batch/stream data-out for a component. */
export interface DataOut {
  batch?: DataFlow;
  stream?: DataFlow;
}

/** A single architectural component (a node on the canvas). */
export interface Component {
  /** Stable UUID. */
  id: string;
  name: string;
  shortName: string;
  category: ComponentCategory;
  /** Icon key from Amr's SVG dictionary. */
  icon: string;
  zone: Zone;
  description: string;
  capabilities: string[];
  /** UUIDs of related components. */
  relatedIds: string[];
  dataOut?: DataOut;
  /** Reference/citation keys. */
  cite: string[];
  what: string;
  users: string;
  kpis: string[];
  teams: string[];
}

/** Edge kind between two components. */
export type EdgeKind = "flow" | "related" | "feeds" | "uses";

/** A directed relationship between two components. */
export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
}

/** A single medallion layer description (short + long form). */
export interface MedallionLayer {
  /** Short label. */
  s: string;
  /** Long description. */
  long: string;
}

/** Bronze/Silver/Gold medallion descriptions for an industry overlay. */
export interface Medallion {
  Bronze: MedallionLayer;
  Silver: MedallionLayer;
  Gold: MedallionLayer;
}

/** An industry overlay selecting a subset of components. */
export interface Industry {
  id: string;
  label: string;
  blurb: string;
  componentIds: string[];
  medallion: Medallion;
}

/** The normalized, serializable architecture document. */
export interface ArchitectureDoc {
  version: 1;
  components: Component[];
  edges: Edge[];
  industries: Industry[];
}

// --- Lucid Standard Import JSON (Lucid's format) -------------------------

/** Shape primitive on a Lucid page. */
export interface LucidShape {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fillColor?: string;
  strokeColor?: string;
}

/** A connector line between two shapes. */
export interface LucidLine {
  id: string;
  sourceId: string;
  destinationId: string;
}

/** A group of shapes on a page. */
export interface LucidGroup {
  id: string;
  /** Shape/line ids that belong to the group. */
  children: string[];
}

/** A single page in a Lucid document. */
export interface LucidPage {
  id: string;
  name: string;
  shapes: LucidShape[];
  lines: LucidLine[];
  groups: LucidGroup[];
}

/** Lucid Standard Import JSON (contents of document.json inside a .lucid archive). */
export interface LucidImportJson {
  version: 1;
  pages: LucidPage[];
}

// --- API response shapes --------------------------------------------------

export interface AuthStatus {
  authenticated: boolean;
  /** Present when authenticated, for diagnostics. */
  session?: string;
}

/** Response from POST /api/embed/session. */
export interface EmbedSessionResponse {
  token: string;
  /** Full embed URL: https://lucid.app/embeds?token=...&mode=editor */
  url: string;
}

/** A lightweight document reference returned by the list/create endpoints. */
export interface DocumentListItem {
  id: string;
  name: string;
}

/** Response from POST /api/documents/create. */
export interface CreateDocumentResponse {
  id: string;
  name: string;
}

/** Read-back contents of a document (polled by the frontend). */
export interface DocumentContents {
  id: string;
  /** Lucid page/shape read-back, opaque to the frontend. */
  pages: LucidPage[];
  /** Last-modified epoch ms reported by Lucid. */
  updatedAt?: number;
}

/** Response from POST /api/industries/:id/activate. */
export interface ActivateIndustryResponse {
  id: string;
  activated: boolean;
}
