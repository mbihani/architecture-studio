// Shape of the architecture data loaded from public/architecture.json.
// Only the fields the POC renders are modeled; extra fields in the JSON
// (capabilities, relatedIds, cite, ...) are ignored.

export interface ArchComponent {
  id: string;
  name: string;
  category: string;
  icon: string;
  zone: string;
  description: string;
}

export interface ArchEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
}

export interface ArchitectureData {
  components: ArchComponent[];
  edges: ArchEdge[];
}
