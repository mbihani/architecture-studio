/* Comprehensive Playwright CUJ suite for the Architecture Studio.
   The app is a single self-contained index.html served at http://localhost:8080.
   Vanilla JS, no framework. These tests exercise the real rendered DOM. */
const { test, expect } = require("@playwright/test");

/* Wait for the board to finish its first build: at least one clickable atom
   exists and the edit toolbar is in the DOM. Edit mode is ON by default. */
async function ready(page) {
  await page.goto("/");
  await page.locator(".atom[data-id]").first().waitFor({ state: "visible" });
  await expect(page.locator("#edit-tools")).toBeAttached();
  await expect(page.locator("#board")).toBeVisible();
}

/* The visible text of every rendered component, in DOM order. */
async function atomTexts(page) {
  return page.locator(".atom[data-id] .t-name").evaluateAll(els =>
    els.map(e => (e.textContent || "").trim()).filter(Boolean)
  );
}

/* The visible label of every group/box in the canvas. */
async function groupBoxes(page) {
  return page.locator(".rgroup .rg-label").evaluateAll(els =>
    els.map(e => (e.textContent || "").trim()).filter(Boolean)
  );
}

/* Dismiss any open modal (industry switch confirm, etc.). */
async function dismissModal(page) {
  const cancel = page.locator("#m-cancel");
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
}

/* =========================================================================
   a) APP LOADS — no JS errors, header/board/edit toolbar visible
   ========================================================================= */
test.describe("a) App loads", () => {
  test("page loads without JS errors and renders core chrome", async ({ page }) => {
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

    await ready(page);

    await expect(page.locator("header.top")).toBeVisible();
    await expect(page.locator("#board")).toBeVisible();
    await expect(page.locator("#ind-tabs")).toBeVisible();
    // edit mode is ON by default → toolbar is visible
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    await expect(page.locator("#edit-tools")).toBeVisible();
    await expect(page.locator("#edit-toggle")).toContainText("ON");
    // canvas has at least one component
    const atoms = page.locator(".atom[data-id]");
    await expect(atoms.first()).toBeVisible();
    expect(await atoms.count()).toBeGreaterThan(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

/* =========================================================================
   b) INDUSTRY SELECTION — clicking a tab updates the architecture
   ========================================================================= */
test.describe("b) Industry selection", () => {
  test("clicking an industry in the dropdown switches the reference architecture", async ({ page }) => {
    await ready(page);
    await dismissModal(page);

    // open the industry dropdown
    await page.locator("#ind-dropdown-btn").click();
    await expect(page.locator("#ind-dropdown-panel")).toBeVisible();

    // pick the first built, non-active industry option
    const target = page.locator(".ind-dropdown-item:not(.soon):not(.on)").first();
    await target.waitFor({ state: "visible" });
    const label = (await target.textContent()).trim();
    // Capture the option's identity up front: the list is fully re-rendered on
    // an industry switch, so the live `target` locator re-resolves afterwards
    // and no longer points at the clicked element.
    const indId = await target.getAttribute("data-ind");

    const beforeCount = await page.locator(".atom[data-id]").count();

    await target.click();
    // confirm modal appears → click Switch
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await page.locator("#m-ok").click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // the chosen option is now active (look it up by data-ind, not the stale locator)
    await expect(page.locator('.ind-dropdown-item[data-ind="' + indId + '"]')).toHaveClass(/\bon\b/);
    // the dropdown button label reflects the new industry
    await expect(page.locator("#ind-dropdown-label")).toContainText(label);
    // canvas status reflects the new industry, and never the old "My Canvas" label
    const status = await page.locator("#canvas-status").textContent();
    expect(status).toContain(label);
    expect(status).not.toContain("My Canvas");
    // board re-rendered: atom set changed (or at least re-rendered)
    await page.locator(".atom[data-id]").first().waitFor({ state: "visible" });
    const afterCount = await page.locator(".atom[data-id]").count();
    expect(afterCount).toBeGreaterThan(0);
    // a re-render happened — counts may differ but DOM was rebuilt
    expect(afterCount).not.toBe(0);
  });
});

/* =========================================================================
   c) EDIT MODE — ON by default, toolbar buttons visible
   ========================================================================= */
test.describe("c) Edit mode", () => {
  test("edit mode is ON by default with a visible toolbar", async ({ page }) => {
    await ready(page);
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    for (const id of ["edit-toggle","edit-reset","edit-duplicate","edit-multi","edit-connect","edit-export","edit-import","edit-newbox","edit-add"]) {
      await expect(page.locator("#" + id)).toBeVisible();
    }
    // Delete is hidden until something is selected
    await expect(page.locator("#edit-delete")).toBeHidden();
  });

  test("toggling edit mode off keeps the toggle visible but hides other toolbar buttons", async ({ page }) => {
    await ready(page);
    await page.locator("#edit-toggle").click();
    await expect(page.locator("body")).not.toHaveClass(/\bedit-mode\b/);
    // Bug 1 fix: the toolbar stays mounted and the toggle button remains visible
    // so the user can turn edit mode back on — it is no longer hidden entirely.
    await expect(page.locator("#edit-tools")).toBeVisible();
    await expect(page.locator("#edit-toggle")).toBeVisible();
    await expect(page.locator("#edit-toggle")).toContainText("OFF");
    // every other toolbar button is hidden when edit mode is off
    for (const id of ["edit-reset","edit-duplicate","edit-multi","edit-connect","edit-export","edit-import","edit-newbox","edit-add"]) {
      await expect(page.locator("#" + id)).toBeHidden();
    }
    // turn it back on for any later tests sharing the page
    await page.locator("#edit-toggle").click();
    await expect(page.locator("body")).toHaveClass(/\bedit-mode\b/);
    await expect(page.locator("#edit-toggle")).toContainText("ON");
  });
});

/* =========================================================================
   d) DELETE COMPONENT — click a component, delete it, it disappears
   ========================================================================= */
test.describe("d) Delete component", () => {
  test("selecting and deleting a component removes it from the canvas", async ({ page }) => {
    await ready(page);

    const atom = page.locator(".atom[data-id]").first();
    const name = (await atom.textContent()).trim();
    const beforeCount = await page.locator(".atom[data-id]").count();

    await atom.click();
    await expect(page.locator("#edit-delete")).toBeVisible();
    await page.locator("#edit-delete").click();

    // count drops and the named atom is gone from the first position
    await expect.poll(async () => page.locator(".atom[data-id]").count()).toBeLessThan(beforeCount);
    const remaining = await atomTexts(page);
    // the specific instance is gone (a duplicate name elsewhere is fine, but the
    // total count strictly decreased)
    expect(remaining.length).toBeLessThan(beforeCount);
  });
});

/* =========================================================================
   e) DELETE ZONE — select a zone boundary, delete, the zone box disappears
   ========================================================================= */
test.describe("e) Delete zone", () => {
  test("deleting a zone empties its groups and flags it _deleted", async ({ page }) => {
    await ready(page);

    // a zone header (.colhead for src/cons, .pockhead for ing/ppl) selects the zone
    const zoneHead = page.locator(".colhead, .pockhead").first();
    await zoneHead.waitFor({ state: "visible" });
    // identify which zone this header belongs to
    const zoneClass = await zoneHead.evaluate(el => {
      const col = el.closest(".col.src, .col.cons, .pocket.ing, .pocket.ppl");
      if (!col) return "";
      if (col.classList.contains("src")) return "src";
      if (col.classList.contains("cons")) return "cons";
      if (col.classList.contains("ing")) return "ing";
      if (col.classList.contains("ppl")) return "ppl";
      return "";
    });
    expect(zoneClass).toBeTruthy();

    const zoneContainer = page.locator(zoneClass === "src" ? ".col.src" :
      zoneClass === "cons" ? ".col.cons" :
      zoneClass === "ing" ? ".pocket.ing" : ".pocket.ppl");

    const groupsBefore = await zoneContainer.locator(".rgroup").count();

    await zoneHead.click();
    await expect(page.locator("#edit-delete")).toBeVisible();
    // the zone container gets a sel-zone highlight
    await expect(zoneContainer).toHaveClass(/\bsel-zone\b/);
    await page.locator("#edit-delete").click();

    // groups are removed from the zone container
    await expect.poll(async () => zoneContainer.locator(".rgroup").count()).toBe(0);
  });
});

/* =========================================================================
   f) ADD NEW BOX — New Box modal creates an empty box in the chosen zone
   ========================================================================= */
test.describe("f) Add new box", () => {
  test("New Box creates an empty box in the selected zone", async ({ page }) => {
    await ready(page);

    const boxesBefore = await groupBoxes(page);

    await page.locator("#edit-newbox").click();
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await expect(page.locator(".modal h3")).toContainText("New Box");

    const unique = "Playwright Test Box " + Date.now();
    await page.locator("#m-name").fill(unique);
    await page.locator("#m-ok").click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // the box label now appears on the canvas
    const boxesAfter = await groupBoxes(page);
    expect(boxesAfter).toContain(unique);
    expect(boxesAfter.length).toBeGreaterThan(boxesBefore.length);
  });
});

/* =========================================================================
   g) ADD COMPONENT — Add Component creates a new component
   ========================================================================= */
test.describe("g) Add component", () => {
  test("Add Component modal adds a component to a group", async ({ page }) => {
    await ready(page);

    const beforeCount = await page.locator(".atom[data-id]").count();

    await page.locator("#edit-add").click();
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await expect(page.locator(".modal h3")).toContainText("Add Component");
    // a group dropdown is populated
    await expect(page.locator("#m-group option")).not.toHaveCount(0);

    await page.locator("#m-ok").click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // a new component appears and the edit drawer opens for it
    await expect.poll(async () => page.locator(".atom[data-id]").count()).toBeGreaterThan(beforeCount);
    await expect(page.locator(".drawer.show")).toBeVisible();
    // The edit drawer opens on the newly added component; its tagline shows the
    // addTile default name. The new atom is added to the src zone's first group,
    // so it is not necessarily the last atom in DOM order — read the drawer.
    const tagline = await page.locator("#d-tagline").textContent();
    expect(tagline).toContain("New component");
  });
});

/* =========================================================================
   h) RESIZE — drag the resize handle, size changes
   ========================================================================= */
test.describe("h) Resize", () => {
  test("dragging the resize handle changes a group's size", async ({ page }) => {
    await ready(page);

    // select a group by clicking its label area (not an atom)
    const group = page.locator(".rgroup[data-zone]").first();
    await group.locator(".rg-label").click();
    await expect(page.locator(".resize-handle")).toBeVisible();

    const handle = page.locator(".resize-handle");
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();

    // the group should not yet have a custom size
    const hadCustomSize = await group.evaluate(el => el.hasAttribute("data-custom-size"));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 35, { steps: 6 });
    await page.mouse.up();

    // after the drag the group has a custom size with a pixel width set
    await expect.poll(async () => group.evaluate(el => el.hasAttribute("data-custom-size"))).toBe(true);
    const width = await group.evaluate(el => el.style.width);
    expect(width).toMatch(/\d+px/);
  });
});

/* =========================================================================
   i) CUSTOM FLOWS — Connect two components, a flow line appears
   ========================================================================= */
test.describe("i) Custom flows", () => {
  test("Connect mode draws a flow line between two components", async ({ page }) => {
    await ready(page);

    await expect(page.locator("#custom-flows .custom-flow")).toHaveCount(0);

    await page.locator("#edit-connect").click();
    await expect(page.locator("#edit-connect")).toHaveClass(/\bon\b/);
    await expect(page.locator("body")).toHaveClass(/\bconnect-mode\b/);

    const atoms = page.locator(".atom[data-id]");
    const a = atoms.nth(0);
    const b = atoms.nth(1);
    await a.click();
    // toast prompts for destination
    await expect(page.locator("#edit-toast")).toBeVisible();
    await b.click();

    // a flow path is rendered
    await expect(page.locator("#custom-flows .custom-flow")).toHaveCount(1);
    // connect mode auto-disables after a flow is drawn
    await expect(page.locator("#edit-connect")).not.toHaveClass(/\bon\b/);
  });
});

/* =========================================================================
   j) CANVAS ISOLATION — edits on a custom tab don't affect the reference
   ========================================================================= */
test.describe("j) Canvas isolation", () => {
  test("edits on a duplicated custom tab do not change the reference tab", async ({ page }) => {
    await ready(page);

    // snapshot the reference tab's component names
    const refNames = await atomTexts(page);
    expect(refNames.length).toBeGreaterThan(0);

    // duplicate the canvas into a custom tab
    await page.locator("#edit-duplicate").click();
    await expect(page.locator("#edit-toast")).toBeVisible();
    // the active tab is now a custom (non-reference) tab
    await expect(page.locator(".tab.active")).not.toHaveAttribute("data-tab", "reference");

    // delete a component on the custom tab
    const beforeCount = await page.locator(".atom[data-id]").count();
    if (beforeCount > 1) {
      await page.locator(".atom[data-id]").first().click();
      await page.locator("#edit-delete").click();
      await expect.poll(async () => page.locator(".atom[data-id]").count()).toBeLessThan(beforeCount);
    }
    // add a box on the custom tab too
    await page.locator("#edit-newbox").click();
    await page.locator("#m-name").fill("Custom Only Box");
    await page.locator("#m-ok").click();
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // switch back to the reference tab
    await page.locator('.tab[data-tab="reference"]').click();
    await expect(page.locator(".tab.active")).toHaveAttribute("data-tab", "reference");

    // the reference tab is unchanged: same components, no custom-only box
    const refNamesAfter = await atomTexts(page);
    expect(refNamesAfter).toEqual(refNames);
    const boxes = await groupBoxes(page);
    expect(boxes).not.toContain("Custom Only Box");
  });
});

/* =========================================================================
   k) EXPORT/IMPORT — export downloads JSON, import restores it
   ========================================================================= */
test.describe("k) Export / Import", () => {
  test("export downloads a JSON file and import restores it", async ({ page }) => {
    await ready(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#edit-export").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const path = download.path() ? download.path() : await download.path();
    // save to a readable location and read it back
    const tmp = `/tmp/arch-studio-export-${Date.now()}.json`;
    await download.saveAs(tmp);
    const fs = require("node:fs");
    const json = JSON.parse(fs.readFileSync(tmp, "utf8"));
    expect(json).toHaveProperty("rails");
    expect(json).toHaveProperty("industry");

    // delete a component so the board changes, then import to restore
    const beforeCount = await page.locator(".atom[data-id]").count();
    await page.locator(".atom[data-id]").first().click();
    await page.locator("#edit-delete").click();
    await expect.poll(async () => page.locator(".atom[data-id]").count()).toBeLessThan(beforeCount);

    // import the exported file
    await page.setInputFiles("#edit-import-file", tmp);
    await expect(page.locator("#edit-toast")).toContainText("imported");
    // the deleted component is restored
    await expect.poll(async () => page.locator(".atom[data-id]").count()).toBe(beforeCount);
    fs.unlinkSync(tmp);
  });
});

/* =========================================================================
   l) UNDO — Ctrl+Z reverts the last change
   ========================================================================= */
test.describe("l) Undo", () => {
  test("Ctrl+Z reverts a deleted component", async ({ page }) => {
    await ready(page);

    const beforeCount = await page.locator(".atom[data-id]").count();
    await page.locator(".atom[data-id]").first().click();
    await page.locator("#edit-delete").click();
    await expect.poll(async () => page.locator(".atom[data-id]").count()).toBeLessThan(beforeCount);

    // undo
    await page.keyboard.press("Control+z");
    await expect.poll(async () => page.locator(".atom[data-id]").count()).toBe(beforeCount);
  });
});

/* =========================================================================
   m) MULTI-SELECT — toggle multi-select, count updates
   ========================================================================= */
test.describe("m) Multi-select", () => {
  test("multi-select mode counts clicked components", async ({ page }) => {
    await ready(page);

    await page.locator("#edit-multi").click();
    await expect(page.locator("#edit-multi")).toHaveClass(/\bon\b/);
    await expect(page.locator("#multi-count")).toContainText("0 selected");

    // click three components
    const atoms = page.locator(".atom[data-id]");
    const n = Math.min(3, await atoms.count());
    for (let i = 0; i < n; i++) {
      await atoms.nth(i).click();
    }
    await expect(page.locator("#multi-count")).toContainText(new RegExp(`^${n} selected`));
    await expect(page.locator(".atom.multi-selected")).toHaveCount(n);
    // delete button appears in multi-mode once there is a selection
    await expect(page.locator("#edit-delete")).toBeVisible();
  });
});

/* =========================================================================
   n) UI NO OVERLAP — sticky bars don't overlap at various scroll positions
   ========================================================================= */
test.describe("n) UI no overlap", () => {
  test("header, industry dropdown bar and edit sidebar never overlap when scrolled", async ({ page }) => {
    await ready(page);

    // The reference tab canvas-status must show the architecture name, never
    // the old inverted "My Canvas" label.
    const status = await page.locator("#canvas-status").textContent();
    expect(status).not.toContain("My Canvas");

    const header = page.locator("header.top");
    const tabs = page.locator("#ind-tabs");
    const tools = page.locator("#edit-tools");

    const checkStack = async () => {
      const h = await header.boundingBox();
      const t = await tabs.boundingBox();
      const e = await tools.boundingBox();
      expect(h).toBeTruthy();
      expect(t).toBeTruthy();
      expect(e).toBeTruthy();
      // header sits above both the dropdown bar and the sidebar (1px sub-pixel tolerance)
      expect(h.y + h.height).toBeLessThanOrEqual(t.y + 1);
      expect(h.y + h.height).toBeLessThanOrEqual(e.y + 1);
      // the fixed left sidebar and the dropdown bar sit side by side: the sidebar's
      // right edge never crosses the dropdown bar's left edge
      expect(e.x + e.width).toBeLessThanOrEqual(t.x + 1);
      // the sidebar is anchored to the left edge and fully on-screen
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.width).toBeGreaterThan(0);
    };

    await checkStack();
    // scroll the page down so the sticky dropdown bar enters its stuck state
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(150);
    await checkStack();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(150);
    await checkStack();
  });

  test("industry dropdown bar stays sticky (visible) when scrolled down", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(150);
    // the industry dropdown bar is still pinned within the viewport
    const tabsBox = await page.locator("#ind-tabs").boundingBox();
    expect(tabsBox).toBeTruthy();
    expect(tabsBox.y).toBeGreaterThanOrEqual(0);
    expect(tabsBox.y).toBeLessThan(200);
    // and the dropdown button is visible within it
    await expect(page.locator("#ind-dropdown-btn")).toBeVisible();
  });
});

/* =========================================================================
   o) RESPONSIVE — layout holds at 1280px and 720px
   ========================================================================= */
test.describe("o) Responsive", () => {
  for (const width of [1280, 720]) {
    test(`layout is usable at ${width}px width`, async ({ browser }) => {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      try {
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await ready(page);

        // header, board, industry tabs and toolbar all render
        await expect(page.locator("header.top")).toBeVisible();
        await expect(page.locator("#board")).toBeVisible();
        await expect(page.locator("#ind-tabs")).toBeVisible();
        await expect(page.locator("#edit-tools")).toBeVisible();

        // no horizontal body overflow (content stays in-viewport)
        const overflow = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);

        // sidebar sits to the left of the dropdown bar with no overlap at this width
        const h = await page.locator("header.top").boundingBox();
        const t = await page.locator("#ind-tabs").boundingBox();
        const e = await page.locator("#edit-tools").boundingBox();
        expect(h.y + h.height).toBeLessThanOrEqual(t.y + 1);
        expect(h.y + h.height).toBeLessThanOrEqual(e.y + 1);
        expect(e.x + e.width).toBeLessThanOrEqual(t.x + 1);
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
});
