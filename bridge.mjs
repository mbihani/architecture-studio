/*
 * bridge.mjs — Architecture Studio <-> Product Research Agent format bridge.
 *
 * Pure ES module. No DOM, no external deps, no side effects on import.
 * Unit-testable under `node --test`. Every function is defensive: it must
 * never throw on missing / malformed keys, it degrades to an empty result.
 *
 * A studio board (from boardSnapshot()) has the shape:
 *   { schema, industry, bands:[...], rails:{src,ing,ppl,cons}, top:{secs}, cloud:{extras,providers} }
 * Tiles (components) carry: n (name), s (short), ic, st, long, caps, caps2,
 * and NAME-reference arrays rel / feeds / comps (the edges). Tiles have no id
 * in the authored board, so we inject a deterministic, persisted `_uid`.
 *
 * Exports:
 *   ensureUids(board)                          -> new board, every tile has a stable _uid
 *   flattenBoardToSemantic(board)              -> { version, industry, components[], edges[] }
 *   buildCardLibrary(board)                    -> [{ n, zone, caps, long }, ...]
 *   applySuggestionsToBoard(board, accepted[]) -> new board with suggestions applied
 */

/* ------------------------------------------------------------------ */
/* internals                                                          */
/* ------------------------------------------------------------------ */

/** Deep clone with the same semantics boardSnapshot() uses (drops functions/undefined). */
function clone(obj) {
  if (obj == null) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_e) {
    return obj;
  }
}

/** Deterministic slug: lower-case, non-alphanumerics -> "-", collapsed & trimmed. */
function slugify(name) {
  return String(name == null ? "" : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "component";
}

/** True when `t` looks like a tile (a component) — an object carrying a name. */
function isTile(t) {
  return t != null && typeof t === "object" && typeof t.n === "string";
}

/**
 * Walk every tile on the board, calling cb(tile, zone) with the LIVE tile object
 * (so callers can mutate it in place). `zone` is a stable location token:
 *   band.id (e.g. "ingest","serve","apps","gov","data",...) for platform bands,
 *   "src" | "ing" | "ppl" | "cons" for rails, "top" for use cases, "cloud" for cloud.
 * Handles every real board shape defensively: cards items, mixed panels
 * (head/cols/side), infra formats, medallion stages, band-level rlbl/foot,
 * rail groups (tiles OR items), top secs tiles, cloud.extras + providers[*][].
 */
function forEachTile(board, cb) {
  if (board == null || typeof board !== "object") return;

  const visitNode = (node, zone) => {
    if (node == null || typeof node !== "object") return;
    if (node.kind === "panel") {
      if (isTile(node.head)) cb(node.head, zone);
      (Array.isArray(node.cols) ? node.cols : []).forEach((t) => { if (isTile(t)) cb(t, zone); });
      (Array.isArray(node.side) ? node.side : []).forEach((t) => { if (isTile(t)) cb(t, zone); });
      return;
    }
    if (isTile(node)) cb(node, zone);
  };

  /* platform bands */
  (Array.isArray(board.bands) ? board.bands : []).forEach((band) => {
    if (band == null || typeof band !== "object") return;
    const zone = typeof band.id === "string" && band.id ? band.id : "platform";
    (Array.isArray(band.rows) ? band.rows : []).forEach((row) => {
      if (row == null || typeof row !== "object") return;
      (Array.isArray(row.items) ? row.items : []).forEach((it) => visitNode(it, zone));
      (Array.isArray(row.formats) ? row.formats : []).forEach((t) => { if (isTile(t)) cb(t, zone); });
      (Array.isArray(row.stages) ? row.stages : []).forEach((t) => { if (isTile(t)) cb(t, zone); });
    });
    if (isTile(band.rlbl)) cb(band.rlbl, zone);
    if (isTile(band.foot)) cb(band.foot, zone);
  });

  /* rails */
  const rails = board.rails && typeof board.rails === "object" ? board.rails : {};
  ["src", "ing", "ppl", "cons"].forEach((zone) => {
    const rail = rails[zone];
    if (rail == null || typeof rail !== "object") return;
    (Array.isArray(rail.groups) ? rail.groups : []).forEach((g) => {
      if (g == null || typeof g !== "object") return;
      const arr = Array.isArray(g.tiles) ? g.tiles : (Array.isArray(g.items) ? g.items : []);
      arr.forEach((t) => { if (isTile(t)) cb(t, zone); });
    });
  });

  /* top / use cases */
  const secs = board.top && Array.isArray(board.top.secs) ? board.top.secs : [];
  secs.forEach((sec) => {
    if (sec == null || typeof sec !== "object") return;
    (Array.isArray(sec.tiles) ? sec.tiles : []).forEach((t) => { if (isTile(t)) cb(t, "top"); });
  });

  /* cloud */
  const cloud = board.cloud && typeof board.cloud === "object" ? board.cloud : {};
  (Array.isArray(cloud.extras) ? cloud.extras : []).forEach((t) => { if (isTile(t)) cb(t, "cloud"); });
  const provs = cloud.providers && typeof cloud.providers === "object" ? cloud.providers : {};
  Object.keys(provs).forEach((pk) => {
    const p = provs[pk];
    if (p == null || typeof p !== "object") return;
    Object.keys(p).forEach((key) => {
      const v = p[key];
      if (Array.isArray(v)) v.forEach((t) => { if (isTile(t)) cb(t, "cloud"); });
    });
  });
}

/** Map a location zone token -> semantic category. */
function categoryForZone(zone) {
  switch (zone) {
    case "src": return "source";
    case "ing": return "ingestion";
    case "ppl": return "platform";
    case "cons": return "consumer";
    case "top": return "usecase";
    case "cloud": return "cloud";
    case "ingest": return "ingestion"; // the platform "Ingest" band
    default: return "platform";        // every other platform band
  }
}

/* ------------------------------------------------------------------ */
/* ensureUids                                                         */
/* ------------------------------------------------------------------ */

/**
 * Return a NEW board where every tile carries a stable `_uid`
 * (`${zone}:${slugify(n)}`, collisions deduped with -2, -3, ...).
 * Idempotent: tiles that already have a `_uid` keep it. Everything else
 * on the board is preserved untouched.
 */
export function ensureUids(board) {
  const next = clone(board);
  if (next == null || typeof next !== "object") return next;

  const seen = new Set();
  // Pass 1: register existing uids so we never collide with them.
  forEachTile(next, (t) => { if (t && typeof t._uid === "string" && t._uid) seen.add(t._uid); });
  // Pass 2: assign a fresh uid to any tile that lacks one.
  forEachTile(next, (t, zone) => {
    if (t == null) return;
    if (typeof t._uid === "string" && t._uid) return;
    const base = `${zone}:${slugify(t.n)}`;
    let uid = base;
    let i = 2;
    while (seen.has(uid)) uid = `${base}-${i++}`;
    seen.add(uid);
    t._uid = uid;
  });
  return next;
}

/** True when every tile on the board already carries a non-empty _uid. */
function allTilesHaveUids(board) {
  let ok = true;
  forEachTile(board, (t) => { if (!(t && typeof t._uid === "string" && t._uid)) ok = false; });
  return ok;
}

/* ------------------------------------------------------------------ */
/* flattenBoardToSemantic                                             */
/* ------------------------------------------------------------------ */

/**
 * Flatten a board into the agent's semantic architecture doc:
 *   { version:1, industry, components:[{id,name,category,capabilities,description}],
 *     edges:[{sourceId,targetId,kind:"related"}] }
 * Edges are resolved from each tile's rel/feeds/comps NAME references to the
 * matching tile _uid (case-insensitive). Unresolved names are skipped.
 */
export function flattenBoardToSemantic(board) {
  const b = allTilesHaveUids(board) ? board : ensureUids(board);
  const components = [];
  const edges = [];
  const nameToUid = new Map(); // lower-cased name -> uid (first occurrence wins)

  forEachTile(b, (t, zone) => {
    if (t == null) return;
    const key = String(t.n == null ? "" : t.n).trim().toLowerCase();
    if (key && !nameToUid.has(key)) nameToUid.set(key, t._uid);
    components.push({
      id: t._uid,
      name: t.n,
      category: categoryForZone(zone),
      capabilities: (Array.isArray(t.caps) ? t.caps : []).concat(Array.isArray(t.caps2) ? t.caps2 : []),
      description: t.long || t.s || "",
    });
  });

  const seenEdge = new Set();
  forEachTile(b, (t) => {
    if (t == null || !t._uid) return;
    const refs = []
      .concat(Array.isArray(t.rel) ? t.rel : [])
      .concat(Array.isArray(t.feeds) ? t.feeds : [])
      .concat(Array.isArray(t.comps) ? t.comps : []);
    refs.forEach((ref) => {
      const target = nameToUid.get(String(ref == null ? "" : ref).trim().toLowerCase());
      if (!target || target === t._uid) return;
      const sig = `${t._uid} ${target}`;
      if (seenEdge.has(sig)) return;
      seenEdge.add(sig);
      edges.push({ sourceId: t._uid, targetId: target, kind: "related" });
    });
  });

  return {
    version: 1,
    industry: (b && b.industry) || "generic",
    components,
    edges,
  };
}

/* ------------------------------------------------------------------ */
/* buildCardLibrary                                                   */
/* ------------------------------------------------------------------ */

/**
 * Flat SKU dump the agent joins on name to recover category / capabilities /
 * description. `zone` is the semantic category so the agent can bucket cards.
 */
export function buildCardLibrary(board) {
  const cards = [];
  forEachTile(board, (t, zone) => {
    if (t == null) return;
    cards.push({
      n: t.n,
      zone: categoryForZone(zone),
      caps: (Array.isArray(t.caps) ? t.caps : []).concat(Array.isArray(t.caps2) ? t.caps2 : []),
      long: t.long || t.s || "",
    });
  });
  return cards;
}

/* ------------------------------------------------------------------ */
/* applySuggestionsToBoard                                            */
/* ------------------------------------------------------------------ */

/** Build an index of every array-held tile (with its containing array) for lookup/remove. */
function indexTiles(board) {
  const byUid = new Map();
  const byName = new Map(); // lower-cased name -> record (first occurrence wins)
  const records = [];

  // Array-held tiles: capture the containing array so we can splice by identity.
  const rails = board.rails && typeof board.rails === "object" ? board.rails : {};
  const pushRec = (tile, zone, arr) => {
    const rec = { tile, zone, arr };
    records.push(rec);
    if (tile && typeof tile._uid === "string") byUid.set(tile._uid, rec);
    const nm = tile && tile.n != null ? String(tile.n).trim().toLowerCase() : "";
    if (nm && !byName.has(nm)) byName.set(nm, rec);
  };

  (Array.isArray(board.bands) ? board.bands : []).forEach((band) => {
    if (band == null || typeof band !== "object") return;
    const zone = typeof band.id === "string" && band.id ? band.id : "platform";
    (Array.isArray(band.rows) ? band.rows : []).forEach((row) => {
      if (row == null || typeof row !== "object") return;
      const items = Array.isArray(row.items) ? row.items : null;
      if (items) items.forEach((it) => {
        if (it && it.kind === "panel") {
          if (isTile(it.head)) pushRec(it.head, zone, null);
          (Array.isArray(it.cols) ? it.cols : []).forEach((t) => { if (isTile(t)) pushRec(t, zone, it.cols); });
          (Array.isArray(it.side) ? it.side : []).forEach((t) => { if (isTile(t)) pushRec(t, zone, it.side); });
        } else if (isTile(it)) {
          pushRec(it, zone, items);
        }
      });
      if (Array.isArray(row.formats)) row.formats.forEach((t) => { if (isTile(t)) pushRec(t, zone, row.formats); });
      if (Array.isArray(row.stages)) row.stages.forEach((t) => { if (isTile(t)) pushRec(t, zone, row.stages); });
    });
    if (isTile(band.rlbl)) pushRec(band.rlbl, zone, null);
    if (isTile(band.foot)) pushRec(band.foot, zone, null);
  });

  ["src", "ing", "ppl", "cons"].forEach((zone) => {
    const rail = rails[zone];
    if (rail == null || typeof rail !== "object") return;
    (Array.isArray(rail.groups) ? rail.groups : []).forEach((g) => {
      if (g == null || typeof g !== "object") return;
      const arr = Array.isArray(g.tiles) ? g.tiles : (Array.isArray(g.items) ? g.items : null);
      if (arr) arr.forEach((t) => { if (isTile(t)) pushRec(t, zone, arr); });
    });
  });

  const secs = board.top && Array.isArray(board.top.secs) ? board.top.secs : [];
  secs.forEach((sec) => {
    if (sec == null || typeof sec !== "object" || !Array.isArray(sec.tiles)) return;
    sec.tiles.forEach((t) => { if (isTile(t)) pushRec(t, "top", sec.tiles); });
  });

  const cloud = board.cloud && typeof board.cloud === "object" ? board.cloud : {};
  if (Array.isArray(cloud.extras)) cloud.extras.forEach((t) => { if (isTile(t)) pushRec(t, "cloud", cloud.extras); });
  const provs = cloud.providers && typeof cloud.providers === "object" ? cloud.providers : {};
  Object.keys(provs).forEach((pk) => {
    const p = provs[pk];
    if (p == null || typeof p !== "object") return;
    Object.keys(p).forEach((key) => {
      const v = p[key];
      if (Array.isArray(v)) v.forEach((t) => { if (isTile(t)) pushRec(t, "cloud", v); });
    });
  });

  return { byUid, byName, records };
}

/** Normalize an agent category string to one of our placement buckets. */
function placementBucket(cat) {
  const c = String(cat == null ? "" : cat).toLowerCase();
  if (c.indexOf("ingest") >= 0) return "ingestion";
  if (c.indexOf("source") >= 0) return "source";
  if (c.indexOf("consum") >= 0) return "consumer";
  if (c.indexOf("use") >= 0) return "usecase"; // "usecase" / "use case"
  if (c.indexOf("cloud") >= 0) return "cloud";
  return "platform";
}

/** Ensure a rail exists with at least one group carrying a `tiles` array; return that array. */
function ensureRailTiles(board, railId) {
  if (!board.rails || typeof board.rails !== "object") board.rails = {};
  let rail = board.rails[railId];
  if (rail == null || typeof rail !== "object") { rail = { id: railId, name: railId, groups: [] }; board.rails[railId] = rail; }
  if (!Array.isArray(rail.groups)) rail.groups = [];
  let g = rail.groups.find((x) => x && Array.isArray(x.tiles));
  if (!g) { g = { box: "AI Recommendations", ic: "folder", tiles: [] }; rail.groups.push(g); }
  return g.tiles;
}

/** Pick (or create) a target array for a net-new tile of the given bucket. */
function placementArrayFor(board, bucket) {
  if (bucket === "source") return ensureRailTiles(board, "src");
  if (bucket === "consumer") return ensureRailTiles(board, "cons");
  if (bucket === "ingestion") {
    // Prefer the platform "Ingest" band's cards row; else the ing rail.
    const bands = Array.isArray(board.bands) ? board.bands : [];
    const ingest = bands.find((b) => b && b.id === "ingest");
    if (ingest) {
      const rows = Array.isArray(ingest.rows) ? ingest.rows : (ingest.rows = []);
      let row = rows.find((r) => r && r.kind === "cards" && Array.isArray(r.items));
      if (!row) { row = { kind: "cards", items: [] }; rows.push(row); }
      return row.items;
    }
    return ensureRailTiles(board, "ing");
  }
  if (bucket === "usecase") {
    if (!board.top || typeof board.top !== "object") board.top = { secs: [] };
    if (!Array.isArray(board.top.secs)) board.top.secs = [];
    let sec = board.top.secs.find((s) => s && Array.isArray(s.tiles));
    if (!sec) { sec = { title: "AI Recommendations", tiles: [] }; board.top.secs.push(sec); }
    return sec.tiles;
  }
  if (bucket === "cloud") {
    if (!board.cloud || typeof board.cloud !== "object") board.cloud = { extras: [], providers: {} };
    if (!Array.isArray(board.cloud.extras)) board.cloud.extras = [];
    return board.cloud.extras;
  }
  // platform: prefer the "Agentic Data" band, else the first band with a cards row.
  const bands = Array.isArray(board.bands) ? board.bands : (board.bands = []);
  const pickBand = bands.find((b) => b && b.id === "data") || bands.find((b) => {
    return b && Array.isArray(b.rows) && b.rows.some((r) => r && r.kind === "cards" && Array.isArray(r.items));
  }) || bands[0];
  if (!pickBand) {
    const band = { id: "ai", name: "AI Recommendations", rows: [{ kind: "cards", items: [] }] };
    bands.push(band);
    return band.rows[0].items;
  }
  if (!Array.isArray(pickBand.rows)) pickBand.rows = [];
  let row = pickBand.rows.find((r) => r && r.kind === "cards" && Array.isArray(r.items));
  if (!row) { row = { kind: "cards", items: [] }; pickBand.rows.push(row); }
  return row.items;
}

/**
 * Apply accepted suggestions to a NEW board (pure — no DOM, no mutation of input):
 *   remove : delete the tile whose _uid===component_id (fallback name===component).
 *   modify : append a "Target: " note to long/s and mark _aiState:"modify".
 *   add    : if component_id resolves to an existing tile, mark it _aiState:"add";
 *            else create a NET-NEW tile and place it by category.
 * The result is designed to keep satisfying the studio's storedStateUsable().
 */
export function applySuggestionsToBoard(board, acceptedSuggestions) {
  const next = ensureUids(board);
  if (next == null || typeof next !== "object") return next;

  const idx = indexTiles(next);
  const usedUids = new Set(idx.records.map((r) => r.tile && r.tile._uid).filter(Boolean));
  const removals = []; // { arr, tile } spliced after the pass, by identity
  const list = Array.isArray(acceptedSuggestions) ? acceptedSuggestions : [];

  const findRec = (s) => {
    if (s && s.component_id != null && idx.byUid.has(s.component_id)) return idx.byUid.get(s.component_id);
    const nm = s && s.component != null ? String(s.component).trim().toLowerCase() : "";
    if (nm && idx.byName.has(nm)) return idx.byName.get(nm);
    return null;
  };

  const mintUid = (bucket, name) => {
    const base = `${bucket}:${slugify(name)}`;
    let uid = base;
    let i = 2;
    while (usedUids.has(uid)) uid = `${base}-${i++}`;
    usedUids.add(uid);
    return uid;
  };

  list.forEach((s) => {
    if (s == null || typeof s !== "object") return;
    const action = String(s.action || "").toLowerCase();

    if (action === "remove") {
      const rec = findRec(s);
      if (rec && Array.isArray(rec.arr)) removals.push({ arr: rec.arr, tile: rec.tile });
      return;
    }

    if (action === "modify") {
      const rec = findRec(s);
      if (!rec || !rec.tile) return;
      const mods = Array.isArray(s.modifications) ? s.modifications.filter(Boolean) : [];
      const noteText = mods.length ? mods.join("; ") : (s.reason || "");
      if (noteText) {
        const note = `Target: ${noteText}`;
        if (rec.tile.long) rec.tile.long = `${rec.tile.long} ${note}`;
        else if (rec.tile.s) rec.tile.s = `${rec.tile.s} ${note}`;
        else rec.tile.long = note;
      }
      rec.tile._aiState = "modify";
      return;
    }

    if (action === "add") {
      const rec = findRec(s);
      if (rec && rec.tile) {
        // Recommended existing component — just flag it.
        rec.tile._aiState = "add";
        return;
      }
      // NET-NEW SKU.
      const bucket = placementBucket(s.category);
      const arr = placementArrayFor(next, bucket);
      if (!Array.isArray(arr)) return;
      const name = s.component != null ? String(s.component) : "New component";
      const tile = {
        n: name,
        s: String(s.setup_notes || "").slice(0, 80),
        long: s.reason || "",
        caps: [],
        _uid: mintUid(bucket, name),
        _aiState: "add",
        _net_new: true,
      };
      arr.push(tile);
    }
  });

  // Apply removals by identity (index-safe).
  removals.forEach(({ arr, tile }) => {
    const i = arr.indexOf(tile);
    if (i >= 0) arr.splice(i, 1);
  });

  return next;
}
