"""Measuring how much of a surface's content lies past the box it is seen through, at each plate format.

The browser tests that hold a surface to "fits without scrolling" share this:
the three plate formats, the boxes the owner lets scroll, a bounded settle, the
plate laid out with the engine's data in, and `hiddenPast`, the measure itself.

- The boxes a surface is seen through are the surface, every box inside it that
  scrolls or clips, every ancestor of it that scrolls or clips, and the page.
  Each is measured by how far the surface's content runs past its visible
  edges, whether the box scrolls or clips, so a surface that stops scrolling by
  hiding its overflow still fails. A box is measured at any size: one that
  collapses to nothing hides everything it holds, and all of it counts.
- Content is what the surface draws: each visible box laid out in it, and each
  line of its visible text, held to its line box. A font's ascent and descent
  reach past the line box without drawing there, so measuring text by them
  would read a whole line as cut. What a nearer box already hides is not
  counted again further out.
- Waits are bounded condition-polls: fonts loaded and every finite animation
  settled.
"""

from playwright.sync_api import Page, ViewportSize

from e2e.support import stack as stack_support

#: The three plate formats, tablet landscape in CSS px.
FORMATS = {
    "expanded": ViewportSize(width=1366, height=1024),
    "normal": ViewportSize(width=1180, height=820),
    "compact": ViewportSize(width=1133, height=744),
}

#: The two boxes the owner lets scroll: a matrix profile's description and the engine log tail.
EXEMPT = 'textarea[data-testid="profile-description"], pre[data-testid="log-tail"]'

#: Hidden length, in CSS px, a box may report from layout rounding alone.
ROUNDING = 1

#: Ceiling on any one wait: data in, a surface opened or closed, animations settled.
#: A ceiling on a condition, never a duration anything is expected to take.
SETTLE_TIMEOUT = 10_000

#: The Output drawer's rail stage, opened once so the plate has the engine's data.
OUTPUT_STAGE = "output"

#: The Output drawer's Format tab, whose rate dial shows once the engine's data is in.
FORMAT_TAB = "format"

#: Function-body prelude: a bounded poll, a settle, and `hiddenPast(root, skip, around, rounding)`,
#: which returns each box `root`'s content runs more than `rounding` px past, worst first, as
#: "<box> <axis> <px>", leaving out whatever lies inside an element matching `skip`.
PRELUDE_JS = """
const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const until = async (cond, ceiling, what) => {
  const end = performance.now() + ceiling;
  while (!cond()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await frame();
  }
};
const settle = async (ceiling) => {
  await document.fonts.ready;
  const end = performance.now() + ceiling;
  const running = () => document.getAnimations().filter(
    (a) => a.effect !== null && a.effect.getComputedTiming().iterations !== Infinity && a.playState === "running",
  );
  for (let left = running(); left.length > 0; left = running()) {
    if (performance.now() > end) throw new Error("timed out waiting for animations to settle");
    await Promise.race([Promise.allSettled(left.map((a) => a.finished)), frame()]);
  }
  await frame();
  await frame();
};
const hiddenPast = (root, skip, around, rounding) => {
  const skipped = (el) => el.closest(skip) !== null;
  const AXES = ["x", "y"];
  const clips = (el, axis) => {
    const style = getComputedStyle(el);
    return (axis === "x" ? style.overflowX : style.overflowY) !== "visible";
  };
  const clipBox = (el) => {
    const b = el.getBoundingClientRect();
    const left = b.left + el.clientLeft;
    const top = b.top + el.clientTop;
    return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
  };
  const REPLACED = ["IMG", "CANVAS", "VIDEO", "INPUT", "SELECT", "TEXTAREA", "IFRAME"];
  const flow = (el) => {
    if (el instanceof SVGElement) return el instanceof SVGSVGElement;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && (style.display !== "inline" || REPLACED.includes(el.tagName));
  };
  const items = [];
  for (const el of root.querySelectorAll("*")) {
    if (skipped(el) || !flow(el)) continue;
    for (const r of el.getClientRects()) {
      if (r.width > 0 && r.height > 0) {
        items.push({ node: el, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
      }
    }
  }
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = texts.nextNode(); t !== null; t = texts.nextNode()) {
    if (t.textContent.trim() === "" || skipped(t.parentElement)) continue;
    if (getComputedStyle(t.parentElement).visibility === "hidden") continue;
    const line = parseFloat(getComputedStyle(t.parentElement).lineHeight);
    const range = document.createRange();
    range.selectNodeContents(t);
    for (const r of range.getClientRects()) {
      if (r.width === 0 || r.height === 0) continue;
      const mid = (r.top + r.bottom) / 2;
      const half = line < r.height ? line / 2 : r.height / 2;
      items.push({ node: t, rect: { left: r.left, right: r.right, top: mid - half, bottom: mid + half } });
    }
  }
  const OUTER = [document.documentElement, document.body];
  const seen = (item, box) => {
    const r = { ...item.rect };
    for (let a = item.node.parentElement; a !== null && a !== box && !OUTER.includes(a); a = a.parentElement) {
      const w = clipBox(a);
      if (clips(a, "x")) Object.assign(r, { left: Math.max(r.left, w.left), right: Math.min(r.right, w.right) });
      if (clips(a, "y")) Object.assign(r, { top: Math.max(r.top, w.top), bottom: Math.min(r.bottom, w.bottom) });
    }
    return r.right > r.left && r.bottom > r.top ? r : null;
  };
  const beyond = (box, w, axis) => {
    let most = 0;
    for (const item of items) {
      if (item.node === box || (box !== null && !box.contains(item.node))) continue;
      const r = seen(item, box);
      if (r === null) continue;
      const past = axis === "x"
        ? Math.max(r.right - w.right, w.left - r.left)
        : Math.max(r.bottom - w.bottom, w.top - r.top);
      most = Math.max(most, past);
    }
    return most;
  };
  const name = (el) => {
    const cls = el.classList.length > 0 ? "." + [...el.classList].join(".") : "";
    const keys = ["data-body", "data-tab", "data-k", "data-testid"].filter((k) => el.hasAttribute(k));
    const attrs = keys.map((k) => `[${k}="${el.getAttribute(k)}"]`).join("");
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls}${attrs}`;
  };
  const found = [];
  const boxes = [root, ...root.querySelectorAll("*")].filter((el) => el instanceof HTMLElement && !skipped(el));
  for (let up = root.parentElement; up !== null && !OUTER.includes(up); up = up.parentElement) boxes.push(up);
  for (const box of boxes) {
    const label = root.contains(box) ? name(box) : `${name(box)} (around ${around})`;
    for (const axis of AXES) if (clips(box, axis)) found.push([label, axis, beyond(box, clipBox(box), axis)]);
  }
  const page = document.documentElement;
  const view = { left: 0, top: 0, right: page.clientWidth, bottom: page.clientHeight };
  for (const axis of AXES) found.push(["the page", axis, beyond(null, view, axis)]);
  return found
    .filter(([, , px]) => px > rounding)
    .sort((a, b) => b[2] - a[2])
    .map(([box, axis, px]) => `${box} ${axis} ${Math.round(px)}px`);
};
"""


def load_plate(page: Page, stack: stack_support.Stack, size: ViewportSize) -> None:
    """Lay the plate out for a window of `size` and wait until the engine's data is in."""
    page.set_viewport_size(size)
    page.goto(f"{stack.base_url}/")
    page.locator(f'button[data-stage="{OUTPUT_STAGE}"]').click(timeout=SETTLE_TIMEOUT)
    drawer = page.locator(f"#drawer-{OUTPUT_STAGE}")
    drawer.locator(f'[role="tab"][data-tab="{FORMAT_TAB}"]').click(timeout=SETTLE_TIMEOUT)
    drawer.locator(f'.dpanel[data-tab="{FORMAT_TAB}"] .dial[role="group"]').wait_for(
        state="visible", timeout=SETTLE_TIMEOUT
    )
