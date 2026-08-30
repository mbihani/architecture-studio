// ---------------------------------------------------------------------------
// IndustrySwitcher — dropdown to switch the active industry diagram page.
//
// Lists industries from GET /api/industries (parsed from the mxfile's
// <diagram> elements). On selection, calls POST /api/industries/:id/activate
// to get the single-page mxfile XML, then passes it to the parent via
// onActivate so the editor loads the new page.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import { api, type ApiError } from "../api/client.ts";
import type { Industry } from "../types/index.ts";

interface IndustrySwitcherProps {
  /** Called with the activated industry's single-page mxfile XML. */
  onActivate: (drawioXml: string) => void;
}

export function IndustrySwitcher({ onActivate }: IndustrySwitcherProps): React.ReactElement {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  // Load the industry list once on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getIndustries()
      .then((list) => {
        if (cancelled) return;
        setIndustries(list);
        if (list.length > 0) setActiveId(list[0].id);
      })
      .catch((err: ApiError) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setActiveId(id);
    setActivating(true);
    setError(null);
    try {
      const res = await api.activateIndustry(id);
      onActivate(res.drawioXml);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setActivating(false);
    }
  };

  return (
    <label className="industry-switcher">
      <span className="industry-switcher__label">Industry</span>
      <select
        className="industry-switcher__select"
        value={activeId}
        onChange={handleChange}
        disabled={loading || activating}
      >
        {loading && <option value="">Loading…</option>}
        {!loading && industries.length === 0 && (
          <option value="">No industries</option>
        )}
        {industries.map((ind) => (
          <option key={ind.id} value={ind.id}>
            {ind.label}
          </option>
        ))}
      </select>
      {activating && <span className="industry-switcher__hint">switching…</span>}
      {error && <span className="industry-switcher__error" title={error}>!</span>}
    </label>
  );
}

export default IndustrySwitcher;
