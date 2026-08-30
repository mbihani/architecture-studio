// ---------------------------------------------------------------------------
// Header — the app top bar.
//
// Renders the "Architecture Studio" title on the left and the provided
// controls (the industry switcher and export button) on the right.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  /** Right-aligned controls, e.g. <IndustrySwitcher /> and <ExportButton />. */
  controls?: ReactNode;
}

export function Header({ title, controls }: HeaderProps): ReactNode {
  return (
    <header className="app-header">
      <h1 className="app-title">{title}</h1>
      <div className="app-controls">{controls}</div>
    </header>
  );
}

export default Header;
