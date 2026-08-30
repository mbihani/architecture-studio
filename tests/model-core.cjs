"use strict";

const RAIL_IDS = ["src", "ing", "ppl", "cons"];
const clone = value => JSON.parse(JSON.stringify(value));

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

function snapshot(state, schema = 26) {
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

module.exports = { RAIL_IDS, clone, applyIndustry, snapshot, persistCustom, loadCustom,
  bulkDelete, deleteZone, hideDeletedZones, buildSummary };
