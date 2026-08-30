// Auto-generated from the architecture-studio converter (ArchitectureDoc).
// First 15 platform components (provenance includes "arch") + edges among them.
// Source: ~/architecture-studio converter/sample-output/architecture.json

export type Category = "source" | "ingestion" | "platform" | "consumer" | "cloud" | "usecase";
export type EdgeKind = "flow" | "related" | "feeds" | "uses";

export interface Component {
  id: string;
  name: string;
  category: Category;
  description: string;
}

export interface ComponentEdge {
  source: string;
  target: string;
  kind: EdgeKind;
}

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  source:    { label: "Sources",    color: "#10b981" },
  ingestion: { label: "Ingestion",  color: "#f59e0b" },
  platform:  { label: "Platform",   color: "#6366f1" },
  consumer:  { label: "Consumers",  color: "#ec4899" },
  cloud:     { label: "Cloud",      color: "#0ea5e9" },
  usecase:   { label: "Apps",       color: "#8b5cf6" },
};

export const EDGE_KIND_COLOR: Record<EdgeKind, string> = {
  flow: "#2563eb",
  related: "#64748b",
  feeds: "#f97316",
  uses: "#10b981",
};

export const components: Component[] = [
  {
    "id": "833b6b4e-a7c7-56d5-a877-1c80f8a988e1",
    "name": "3rd Party CDPs",
    "category": "consumer",
    "description": "Customer data platforms that compose on top of the lakehouse instead of holding their own copy: Hightouch, Census, RudderStack and similar read governed profiles and segments in place and activate them to campaign and service channels, so the warehouse stays the single source of customer truth. The Databricks-native path for the same job is CustomerLake."
  },
  {
    "id": "2e48fa91-c26b-5aa8-bca8-35b3e4970521",
    "name": "3rd-Party Marketplaces",
    "category": "consumer",
    "description": "External data and model marketplaces your products are listed on, and third-party listings consumed back into the lakehouse, exchanged over Open Sharing with no copy."
  },
  {
    "id": "83fb62d2-199a-5e35-8b0e-15c9aef8b916",
    "name": "3rd-Party SaaS Apps",
    "category": "consumer",
    "description": "Packaged applications that both feed the platform and consume its outputs, connected through Lakeflow Connect inbound and Reverse ETL outbound."
  },
  {
    "id": "72e910d6-5174-5a7b-90a7-7ecea96d9c89",
    "name": "Activation Channels",
    "category": "consumer",
    "description": "Campaign, service and commerce channels activated from governed segments."
  },
  {
    "id": "03a4485e-099f-5f4c-b619-df8a0c69c119",
    "name": "ADLS Gen2",
    "category": "cloud",
    "description": "Azure Data Lake Storage Gen2 holds the open-format lake. Databricks reads and writes in place; you keep the data."
  },
  {
    "id": "70fb90b9-bbc7-5dbe-bac0-4772c7c04155",
    "name": "Agent Bricks",
    "category": "platform",
    "description": "The enterprise agent platform, with 100k+ agents built. DAIS 2026 expanded it to multi-harness: added Kimi (Moonshot AI) and Grok (xAI), managed memory, Document Intelligence and the Databricks Sandbox."
  },
  {
    "id": "f49cecca-1696-5b36-952f-452d2864a0cb",
    "name": "Agentic Dev",
    "category": "platform",
    "description": "The developer surface of the platform: notebooks, IDE integrations, MLflow, AI Runtime serverless GPU compute and Databricks Asset Bundles for shipping agents, apps and models to production."
  },
  {
    "id": "f5b28d6a-7066-5919-aa95-f222a27a04de",
    "name": "AI Search",
    "category": "platform",
    "description": "Formerly Databricks Vector Search. Managed vector indexes kept in sync with governed tables, so retrieval for agents and search inherits the same permissions as the source data."
  },
  {
    "id": "a2a3c85b-0453-59f9-8ce0-12f67c812fa6",
    "name": "AI/BI",
    "category": "platform",
    "description": "Governed dashboards and natural-language analytics built directly on lakehouse tables, with Genie behind the ask-a-question experience."
  },
  {
    "id": "cb0d9613-828f-50e2-807a-d33d8a759f5a",
    "name": "Analytics Engineers",
    "category": "consumer",
    "description": "The layer between engineering and analysis. They model raw tables into tested, documented marts and own what the business words actually mean."
  },
  {
    "id": "0611ad72-8bed-5c3d-aabd-bb0a5c96d129",
    "name": "Anthropic/OpenAI",
    "category": "cloud",
    "description": "Anthropic Claude and OpenAI GPT models called through Unity Gateway, with the same spend caps, tracing and policy as any other model."
  },
  {
    "id": "734a143f-27c0-5867-9f84-c7bfe5d485b3",
    "name": "Any MCP Harness",
    "category": "consumer",
    "description": "Cursor and other IDE agents, LangGraph and CrewAI frameworks, and any other harness that speaks MCP. The MCP server registry in Unity Gateway is the single place a new one is admitted, scoped and traced."
  },
  {
    "id": "a358df43-cb72-5d82-9663-de704c8e04e8",
    "name": "Apache Iceberg",
    "category": "platform",
    "description": "Managed Iceberg tables went GA in Databricks Runtime at DAIS 2026 with Iceberg v3, unifying data files across Delta and Iceberg at the storage layer for true cross-engine interoperability."
  },
  {
    "id": "e91c47e2-d2bb-59be-8200-cdd360c5ca73",
    "name": "Apache Spark",
    "category": "platform",
    "description": "The distributed engine Databricks was founded on and still leads. Photon accelerates the same Spark API, and Spark Declarative Pipelines (donated from Delta Live Tables) landed in Spark 4.1."
  },
  {
    "id": "793d7e48-2e98-5dfb-8588-d383af1bc478",
    "name": "APIs & Webhooks",
    "category": "source",
    "description": "REST, GraphQL and webhook payloads pulled on schedule or pushed on event."
  }
];

export const edges: ComponentEdge[] = [
  {
    "source": "f5b28d6a-7066-5919-aa95-f222a27a04de",
    "target": "70fb90b9-bbc7-5dbe-bac0-4772c7c04155",
    "kind": "related"
  },
  {
    "source": "f49cecca-1696-5b36-952f-452d2864a0cb",
    "target": "70fb90b9-bbc7-5dbe-bac0-4772c7c04155",
    "kind": "related"
  }
];

