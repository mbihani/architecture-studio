// ---------------------------------------------------------------------------
// Backend-local TypeScript types.
//
// The frontend (src/types/index.ts) and backend keep their own copies of the
// shared data-model types so each TS project (tsconfig.app.json /
// server/tsconfig.json) is self-contained under project references. Both
// mirror the data model defined in ARCHITECTURE.md.
// ---------------------------------------------------------------------------

// --- Lucid Standard Import JSON (Lucid's format) -------------------------

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

export interface LucidLine {
  id: string;
  sourceId: string;
  destinationId: string;
}

export interface LucidGroup {
  id: string;
  children: string[];
}

export interface LucidPage {
  id: string;
  name: string;
  shapes: LucidShape[];
  lines: LucidLine[];
  groups: LucidGroup[];
}

export interface LucidImportJson {
  version: 1;
  pages: LucidPage[];
}

// --- ArchitectureDoc (our semantic format) -------------------------------

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

export interface Industry {
  id: string;
  label: string;
  blurb: string;
  componentIds: string[];
  medallion: Medallion;
}

export interface ArchitectureDoc {
  version: 1;
  components: Component[];
  edges: Edge[];
  industries: Industry[];
}
