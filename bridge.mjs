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
 *   applySuggestionsToBoard(board, accepted[], opts?) -> new board with suggestions applied
 *       opts = { flow:[names], focus:[names] } drives use-case focus mode:
 *       marks _focus / _peripheral on every tile and stamps a 1-based _flowOrder
 *       on tiles named in `flow`. Applied add/modify tiles also carry _aiReason /
 *       _replaces, and any existing tile they name in `replaces` is greyed
 *       (_aiState:"remove") so the replacement is visible on the canvas.
 *   boardToSpecMarkdown(board)                 -> string (Markdown spec of the board)
 *   extractionToCurrentState(extractResponse)  -> { components:[{name,category,description}],
 *                                                   connections:[{source,target,kind}] }
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
/* extractionToCurrentState                                           */
/* ------------------------------------------------------------------ */

/**
 * Map a vision-extraction response
 *   { components:[{name,type,category,description}], connections:[{source,target,kind}], zones, summary }
 * into the `current_state` shape the agent's /api/studio/suggest accepts
 * (its `_normalize_arch` reads `{components, connections}`):
 *   { components:[{name,category,description}], connections:[{source,target,kind}] }
 *
 * Pure + defensive: never throws on missing / malformed input, degrades to
 * empty arrays. Components with a blank name are dropped (they carry no signal
 * and would confuse name-matching downstream). Connections are passed through,
 * normalized to {source,target,kind} — no filtering by component reference.
 */
export function extractionToCurrentState(extractResponse) {
  const src = extractResponse && typeof extractResponse === "object" ? extractResponse : {};

  const components = [];
  (Array.isArray(src.components) ? src.components : []).forEach((c) => {
    if (c == null || typeof c !== "object") return;
    const name = String(c.name == null ? "" : c.name).trim();
    if (!name) return; // drop empty-name components
    components.push({
      name,
      category: c.category == null ? "" : String(c.category),
      description: c.description == null ? "" : String(c.description),
    });
  });

  const connections = [];
  (Array.isArray(src.connections) ? src.connections : []).forEach((cn) => {
    if (cn == null || typeof cn !== "object") return;
    connections.push({
      source: cn.source == null ? "" : String(cn.source),
      target: cn.target == null ? "" : String(cn.target),
      kind: cn.kind == null ? "" : String(cn.kind),
    });
  });

  return { components, connections };
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
 *   remove : MARK the matched tile _aiState:"remove" and KEEP it in place (do not
 *            splice). This (i) lets the target diagram show what is being retired
 *            (the Phase-4 diff view) and (ii) prevents removing platform tiles from
 *            dropping the board below the studio's storedStateUsable() threshold
 *            (>= 60% of BASE platform tiles), which was silently rejecting the
 *            applied board and leaving the canvas un-rendered.
 *   modify : append a "Target: " note to long/s and mark _aiState:"modify".
 *   add    : if component_id resolves to an existing tile, mark it _aiState:"add";
 *            else create a NET-NEW tile (given a generic `product` icon so it draws
 *            as a real glyph, not a bare dot) and place it by category.
 * Every applied add/modify also stamps its `reason` (_aiReason) and `replaces`
 * (_replaces) onto the affected tile, and greys any existing tile it names in
 * `replaces` (see below). `opts = { flow, focus }` then drives focus mode.
 * The result is designed to keep satisfying the studio's storedStateUsable().
 */
export function applySuggestionsToBoard(board, acceptedSuggestions, opts) {
  const next = ensureUids(board);
  if (next == null || typeof next !== "object") return next;

  const idx = indexTiles(next);
  const usedUids = new Set(idx.records.map((r) => r.tile && r.tile._uid).filter(Boolean));
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

  /* Coerce a value (list, scalar, or nullish) to a clean array of non-empty strings. */
  const normStrList = (v) =>
    (Array.isArray(v) ? v : (v == null ? [] : [v]))
      .map((x) => String(x == null ? "" : x).trim())
      .filter(Boolean);

  /* Feature 1: record WHY a tile is in the target and WHAT it supplants. */
  const stampReason = (tile, s) => {
    if (!tile || !s) return;
    const reason = s.reason == null ? "" : String(s.reason);
    if (reason) tile._aiReason = reason;
    const rep = normStrList(s.replaces);
    if (rep.length) tile._replaces = rep;
  };

  list.forEach((s) => {
    if (s == null || typeof s !== "object") return;
    const action = String(s.action || "").toLowerCase();

    if (action === "remove") {
      const rec = findRec(s);
      // M6a: mark, do NOT splice — keep the tile so the diff view can show it as
      // retiring and so the platform-tile count never falls under the gate.
      if (rec && rec.tile) rec.tile._aiState = "remove";
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
      stampReason(rec.tile, s);
      return;
    }

    if (action === "add") {
      const rec = findRec(s);
      if (rec && rec.tile) {
        // Recommended existing component — just flag it.
        rec.tile._aiState = "add";
        stampReason(rec.tile, s);
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
        // A valid ICONS key (verified present) so the renderer draws a real glyph
        // instead of falling back to the generic `dot`. The renderer also tolerates
        // a missing `ic` (svg()/titleIcon() fall back to ICONS.dot), so this is
        // belt-and-braces, not load-bearing.
        ic: "product",
        _uid: mintUid(bucket, name),
        _aiState: "add",
        _net_new: true,
      };
      stampReason(tile, s);
      arr.push(tile);
    }
  });

  /* Feature 1 — replacement visibility: for every applied add/modify that names
     things it supplants, grey the matching EXISTING board tile (by name,
     case-insensitive) so the retiring component is visible even when the user
     didn't separately accept its removal. `idx.byName` was built before any
     net-new tiles were pushed, so this only ever touches pre-existing tiles.
     A tile already flagged add/modify (it is itself a target) is left alone. */
  const replaced = new Set();
  list.forEach((s) => {
    if (s == null || typeof s !== "object") return;
    const action = String(s.action || "").toLowerCase();
    if (action !== "add" && action !== "modify") return;
    normStrList(s.replaces).forEach((nm) => replaced.add(nm.toLowerCase()));
  });
  replaced.forEach((nm) => {
    const rec = idx.byName.get(nm);
    if (rec && rec.tile && rec.tile._aiState !== "add" && rec.tile._aiState !== "modify") {
      rec.tile._aiState = "remove";
    }
  });

  /* Feature 2 — use-case focus mode. When a focus set is supplied, mark every
     tile _focus (in the use-case flow) or _peripheral (reference context that
     should recede). AI-touched tiles (net-new / add / modify) are always in
     focus. `flow` (the ordered end-to-end path) stamps a 1-based _flowOrder so
     the renderer can draw an ordinal badge. Purely visual: no tile is removed,
     so this never trips storedStateUsable(). */
  const focusList = opts && Array.isArray(opts.focus) ? opts.focus : [];
  const flowList = opts && Array.isArray(opts.flow) ? opts.flow : [];
  if (focusList.length) {
    const focusSet = new Set(
      focusList.map((x) => String(x == null ? "" : x).trim().toLowerCase()).filter(Boolean),
    );
    const flowIdx = new Map(); // lower-cased name -> 1-based order (first occurrence wins)
    flowList.forEach((nm, i) => {
      const k = String(nm == null ? "" : nm).trim().toLowerCase();
      if (k && !flowIdx.has(k)) flowIdx.set(k, i + 1);
    });
    forEachTile(next, (t) => {
      if (t == null) return;
      const nm = String(t.n == null ? "" : t.n).trim().toLowerCase();
      const aiTouched = t._net_new === true || t._aiState === "add" || t._aiState === "modify";
      if (focusSet.has(nm) || aiTouched) { t._focus = true; delete t._peripheral; }
      else { t._peripheral = true; delete t._focus; }
      if (nm && flowIdx.has(nm)) t._flowOrder = flowIdx.get(nm);
      else delete t._flowOrder;
    });
  }

  return next;
}

/* ------------------------------------------------------------------ */
/* boardToSpecMarkdown                                                */
/* ------------------------------------------------------------------ */

/** Title-case an industry id ("wealth_management" -> "Wealth Management"). */
function titleizeIndustry(ind) {
  const s = String(ind == null ? "" : ind).trim();
  if (!s) return "Generic";
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ") || "Generic";
}

/** Category display labels for the spec. */
const SPEC_CATEGORY_LABEL = {
  platform: "Platform & Governance",
  cloud: "Cloud & Integrations",
  source: "Sources",
  ingestion: "Ingestion",
  consumer: "Consumers",
  usecase: "Use Cases",
};

/* A deterministic, dependency-ordered build sequence: the cloud substrate and
   the platform/governance layer come first, then the sources they read, then
   ingestion, then who and what consumes the governed results. Any category not
   listed here is appended alphabetically. */
const SPEC_SETUP_ORDER = ["cloud", "platform", "source", "ingestion", "consumer", "usecase"];

function specLabelFor(cat) {
  return SPEC_CATEGORY_LABEL[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
}

/**
 * Render the CURRENT board as a Markdown spec for the demo-creation team.
 * Pure + defensive: never throws; degrades to a minimal doc on empty input.
 *   - Title (industry) + a summary line (component counts by category + edges).
 *   - Component inventory grouped by category: name · capabilities · description.
 *   - Data-flow section derived from edges (source → target).
 *   - A dependency-ordered setup sequence (cloud/platform → sources → ingestion
 *     → consumers/use-cases).
 */
export function boardToSpecMarkdown(board) {
  const doc = flattenBoardToSemantic(board);
  const comps = Array.isArray(doc.components) ? doc.components : [];
  const edges = Array.isArray(doc.edges) ? doc.edges : [];
  const title = titleizeIndustry(doc.industry);

  const idToName = new Map();
  comps.forEach((c) => { if (c && c.id != null) idToName.set(c.id, c.name); });

  // Group components by category, preserving first-seen order within a group.
  const byCat = new Map();
  comps.forEach((c) => {
    const cat = c && c.category ? String(c.category) : "platform";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(c);
  });
  // Iteration order: the known dependency order first, then any extras sorted.
  const cats = [];
  SPEC_SETUP_ORDER.forEach((k) => { if (byCat.has(k)) cats.push(k); });
  [...byCat.keys()].sort().forEach((k) => { if (cats.indexOf(k) < 0) cats.push(k); });

  const lines = [];
  lines.push(`# ${title} — Target Architecture Spec`);
  lines.push("");

  // Summary line: total + per-category counts + flow count.
  const perCat = cats.map((c) => `${specLabelFor(c)} ${byCat.get(c).length}`).join(", ");
  lines.push(
    `**${comps.length}** component${comps.length === 1 ? "" : "s"}` +
    (perCat ? ` (${perCat})` : "") +
    ` · **${edges.length}** data flow${edges.length === 1 ? "" : "s"}.`,
  );
  lines.push("");

  // Component inventory grouped by category.
  lines.push("## Component Inventory");
  if (!comps.length) {
    lines.push("");
    lines.push("_No components on the board._");
  } else {
    cats.forEach((cat) => {
      const items = byCat.get(cat);
      lines.push("");
      lines.push(`### ${specLabelFor(cat)} (${items.length})`);
      items.forEach((c) => {
        const caps = Array.isArray(c.capabilities) ? c.capabilities.filter(Boolean) : [];
        const parts = [];
        if (caps.length) parts.push(caps.join(", "));
        const desc = c && c.description ? String(c.description).trim() : "";
        if (desc) parts.push(desc);
        const suffix = parts.length ? ` — ${parts.join(" · ")}` : "";
        lines.push(`- **${c.name}**${suffix}`);
      });
    });
  }
  lines.push("");

  // Data flows from resolved edges.
  lines.push("## Data Flows");
  lines.push("");
  if (!edges.length) {
    lines.push("_No explicit data flows defined._");
  } else {
    edges.forEach((e) => {
      const from = idToName.get(e.sourceId) || e.sourceId;
      const to = idToName.get(e.targetId) || e.targetId;
      const kind = e && e.kind ? ` (${e.kind})` : "";
      lines.push(`- ${from} → ${to}${kind}`);
    });
  }
  lines.push("");

  // Dependency-ordered setup sequence.
  lines.push("## Setup Sequence");
  lines.push("");
  let n = 0;
  cats.forEach((cat) => {
    byCat.get(cat).forEach((c) => {
      n += 1;
      const desc = c && c.description ? String(c.description).trim() : "";
      const short = desc ? ` — ${desc.length > 160 ? desc.slice(0, 157) + "…" : desc}` : "";
      lines.push(`${n}. **${c.name}** _(${specLabelFor(cat)})_${short}`);
    });
  });
  if (!n) lines.push("_Nothing to set up._");
  lines.push("");

  return lines.join("\n");
}
