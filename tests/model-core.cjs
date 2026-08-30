"use strict";

const RAIL_IDS = ["src", "ing", "ppl", "cons"];
const SCHEMA = 26;                       /* mirrors index.html const SCHEMA */
const PROVIDER_TILE_KEYS = ["fed","ingest","bi","identity","govcat","aisvc","cicd","services"];
const clone = value => JSON.parse(JSON.stringify(value));

/* Mirror of the safeName() sanitizer in the edit surface: strip C0 control
   chars (0x00-0x1f), DEL (0x7f) and angle brackets, trim, and cap length so a
   pasted blob can't blow up the board or inject markup. The control-char class
   is built at runtime from char codes so the source holds no literal control
   bytes. */
const _CTRL_RE = (function(){
  let cls = "";
  for(let c = 0; c <= 0x1f; c++) cls += String.fromCharCode(c);
  cls += String.fromCharCode(0x7f) + "<>";
  return new RegExp("[" + cls + "]", "g");
})();
function safeName(value){
  return String(value == null ? "" : value).replace(_CTRL_RE, "").trim().slice(0, 120);
}

function applyIndustry(state, base, industries, id) {
  const fresh = clone(base);
  state.rails = fresh.rails;
  state.top = fresh.top;
  RAIL_IDS.forEach(rid => delete state.rails[rid]._deleted);
  const overlay = industries[id];
  state.industry = overlay ? id : "generic";
  if (overlay && overlay.rails) {
    RAIL_IDS.forEach(rid => {
      if (Array.isArray(overlay.rails[rid])) state.rails[rid].groups = clone(overlay.rails[rid]);
    });
  }
  state._customFlows = [];
  return state;
}

function snapshot(state, schema = SCHEMA) {
  return clone({ schema, industry: state.industry, bands: state.bands, rails: state.rails,
    top: state.top, cloud: state.cloud, _customFlows: state._customFlows || [] });
}
function persistCustom(store, key, state) { store.set(key, JSON.stringify(snapshot(state))); }
function loadCustom(store, key, state) {
  const raw = store.get(key); if (!raw) return false;
  const saved = JSON.parse(raw);
  Object.assign(state, clone(saved));
  return true;
}

/* Structural validation mirroring index.html storedStateUsable(). The app's
   version also gates on a platform-tile-count heuristic against BASE.bands,
   which has no analogue in this headless module (BASE isn't available here);
   every other structural check is faithful. */
function storedStateUsable(s){
  if(!s || s.schema !== SCHEMA) return false;
  if(s.industry != null && typeof s.industry !== "string") return false;
  if(!Array.isArray(s.bands) || !s.bands.length) return false;
  if(!s.rails || !RAIL_IDS.every(id => s.rails[id] && Array.isArray(s.rails[id].groups))) return false;
  if(!s.top || !Array.isArray(s.top.secs) || !s.top.secs.every(x => Array.isArray(x.tiles))) return false;
  if(!s.cloud || !Array.isArray(s.cloud.extras)) return false;
  const provs = s.cloud.providers;
  if(!provs || !Object.keys(provs).length) return false;
  return Object.values(provs).every(p => PROVIDER_TILE_KEYS.every(k => Array.isArray(p[k])));
}

function bulkDelete(state, items) {
  const groups = items.filter(x => x.type === "group").sort((a,b) => a.zone === b.zone ? b.gidx-a.gidx : a.zone.localeCompare(b.zone));
  items.filter(x => x.type === "atom").forEach(x => {
    const tiles = state.rails[x.zone].groups[x.gidx]?.tiles || [];
    const i = tiles.findIndex(t => t.n === x.name); if (i >= 0) tiles.splice(i, 1);
  });
  groups.forEach(x => state.rails[x.zone].groups.splice(x.gidx, 1));
}

function deleteZone(state, zone) { state.rails[zone].groups = []; state.rails[zone]._deleted = true; }
function hideDeletedZones(state, elements) {
  RAIL_IDS.forEach(id => { elements[id].display = state.rails[id]._deleted ? "none" : ""; });
}
function buildSummary(state) {
  return RAIL_IDS.reduce((out, id) => { out[id] = (state.rails[id].groups || []).flatMap(g => g.tiles || []).map(t => t.n); return out; }, {});
}

/* ---------- production-readiness mirrors ---------- */

/* New Box modal validation: non-empty (after sanitizing) and unique within the
   chosen zone. Mirrors the onOk handler's two rejection paths. */
function validateBoxName(state, zone, raw){
  const name = safeName(raw);
  if(!name) return { ok:false, reason:"empty" };
  const dup = (state.rails[zone].groups || []).some(g => g.box === name);
  if(dup) return { ok:false, reason:"duplicate", name };
  return { ok:true, name };
}

/* Component (atom) name validation: non-empty after trim. Mirrors openEdit()'s
   save guard. */
function validateComponentName(raw){
  const name = String(raw == null ? "" : raw).trim();
  if(!name) return { ok:false, reason:"empty" };
  return { ok:true, name };
}

/* Export the canvas as a pretty-printed JSON string (mirrors exportBtn). */
function exportJSON(state){ return JSON.stringify(snapshot(state), null, 2); }

/* Import a JSON string: parse, structurally validate, then load into state.
   Mirrors importFile.onchange (parse -> storedStateUsable -> load). */
function importJSON(text, state){
  if(typeof text !== "string") return { ok:false, reason:"not-string" };
  let s;
  try { s = JSON.parse(text); } catch(_){ return { ok:false, reason:"invalid-json" }; }
  if(!storedStateUsable(s)) return { ok:false, reason:"invalid-structure" };
  Object.assign(state, clone(s));
  if(!Array.isArray(state._customFlows)) state._customFlows = [];
  return { ok:true };
}

/* Snapshot-based undo stack. rememberUndo() pushes a pre-mutation snapshot
   before any destructive action; undo() pops the most recent one and restores
   the mutable fields. Capped, and clearable on an industry switch. Mirrors the
   undoStack / rememberUndo / undoOnce trio in the edit surface. */
function makeUndo(limit){
  limit = limit || 50;
  const stack = [];
  return {
    push(state){ stack.push(clone(state)); if(stack.length > limit) stack.shift(); },
    undo(state){
      if(!stack.length) return false;
      const prev = stack.pop();
      state.rails = prev.rails; state.top = prev.top; state.industry = prev.industry;
      state._customFlows = prev._customFlows || [];
      return true;
    },
    size(){ return stack.length; },
    clear(){ stack.length = 0; },
  };
}

/* Enumerate every selectable item across the canvas, skipping deleted zones.
   Empty groups are selectable as a group; non-empty groups contribute their
   atoms. Mirrors the Ctrl+A select-all handler. */
function allSelectable(state){
  const items = [];
  RAIL_IDS.forEach(zid => {
    const rail = state.rails[zid];
    if(!rail || rail._deleted) return;
    (rail.groups || []).forEach((g, gi) => {
      const tiles = g.tiles || [];
      if(!tiles.length) items.push({ type:"group", zone:zid, gidx:gi, name:g.box });
      tiles.forEach(t => items.push({ type:"atom", zone:zid, gidx:gi, name:t.n }));
    });
  });
  return items;
}

/* A group counts as empty when it has no tiles. Mirrors the .rtiles:empty CSS
   rule that paints the "Empty box" placeholder. */
function groupEmpty(group){ return !group || !group.tiles || !group.tiles.length; }

/* Zone-level empty-state message: shown only when a visible (non-deleted) zone
   has lost all its boxes, mirroring updateEmptyStates(). */
function emptyStateMessage(state, zone){
  const rail = state.rails[zone];
  if(!rail || rail._deleted) return null;
  if(!rail.groups || !rail.groups.length) return "No boxes in this zone — use “New Box” to add one.";
  return null;
}

module.exports = { RAIL_IDS, SCHEMA, PROVIDER_TILE_KEYS, clone, safeName,
  applyIndustry, snapshot, storedStateUsable, persistCustom, loadCustom,
  bulkDelete, deleteZone, hideDeletedZones, buildSummary,
  validateBoxName, validateComponentName, exportJSON, importJSON, makeUndo,
  allSelectable, groupEmpty, emptyStateMessage };
