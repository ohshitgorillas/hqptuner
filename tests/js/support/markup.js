// Rendered-markup scanning shared by the suites that ask what a region of a
// card encloses. Lifted from tests/js/components/liveplayback.test.js, which
// settled the convention: the disabled state a control carries when the engine
// has taken it away is the `off` class token (`knob knob-lg off`, `dsp-body
// off`), and the region carrying it is the OUTERMOST element inside the
// fragment that carries the token.
//
// A tag-balancing scan rather than a structural selector, so an assertion can
// ask what a region does and does not enclose without naming any structure the
// component is free to change.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track"]);

// Every element in a fragment, with its own outer HTML.
//
// An element left open when its parent closes, or at the end of the fragment,
// raises rather than being dropped: a silently shorter list makes the questions
// below ("what is the OUTERMOST element carrying this?", "what is the SMALLEST
// element enclosing that?") quietly answer about the wrong element.
export function elements(out) {
  // The attribute run is greedy, not lazy, and the name is followed by a
  // lookahead: both alternatives inside the run start with a different
  // character class, so a greedy run has exactly one way to match and the
  // engine never re-splits it. A lazy run plus a trailing (\/?) gave it two.
  // The self-closing slash lands at the end of the run and is peeled off below.
  const tag = /<(\/?)([a-zA-Z][\w-]*)(?=[\s/>])((?:[^>"]|"[^"]*")*)>/g;
  const stack = [];
  const all = [];
  let m;
  while ((m = tag.exec(out)) !== null) {
    const [full, close, name, run] = m;
    const selfClose = run.endsWith("/");
    const attrs = selfClose ? run.slice(0, -1) : run;
    if (close) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at < 0) continue;
      const [open, ...unclosed] = stack.splice(at);
      if (unclosed.length > 0) throw new Error(`<${unclosed[0].name}> is never closed inside <${name}>`);
      all.push({ name, attrs: open.attrs, start: open.start, html: out.slice(open.start, tag.lastIndex) });
      continue;
    }
    if (selfClose || VOID.has(name)) all.push({ name, attrs, start: m.index, html: full });
    else stack.push({ name, attrs, start: m.index });
  }
  if (stack.length > 0) throw new Error(`<${stack[0].name}> is never closed in the fragment`);
  return all;
}

export const classes = (el) => ((/class="([^"]*)"/.exec(el.attrs) || [])[1] || "").split(/\s+/);

// What a reader sees inside an element: markup stripped, whitespace collapsed.
export const text = (el) =>
  el.html
    .replace(/<[^<>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Whether an attribute is present on an element, with or without a value —
// `checked` and `checked=""` both count, `data-checked` does not.
export const hasAttr = (el, name) => new RegExp(`(^|\\s)${name}(\\s|=|$)`).test(el.attrs);

const same = (a, b) => a.start === b.start && a.html.length === b.html.length;

// The smallest element of the fragment that encloses `el` and is not `el`
// itself: the row, region or card a control is wrapped in, named by what it
// contains rather than by the class the component happens to give it.
export function enclosing(fragment, el) {
  const end = el.start + el.html.length;
  const around = elements(fragment).filter(
    (e) => e.start <= el.start && e.start + e.html.length >= end && !same(e, el),
  );
  if (around.length === 0) throw new Error(`nothing in the fragment encloses <${el.name}>`);
  return around.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

const labels = (fragment, name) => elements(fragment).filter((el) => el.name === "label" && text(el).startsWith(name));

// The `<label>` a control is announced by. Matched on the text a reader sees,
// so a `for=`, a class or a trailing hint span on the label changes nothing.
export function labelled(fragment, name) {
  const [hit] = labels(fragment, name);
  if (!hit) throw new Error(`no control labelled "${name}" in the fragment`);
  return hit;
}

export const hasLabel = (fragment, name) => labels(fragment, name).length > 0;

// The outermost element inside a fragment carrying the disabled marker.
export function disabledRegion(fragment) {
  const marked = elements(fragment).filter((el) => classes(el).includes("off"));
  if (marked.length === 0) throw new Error("nothing in the fragment carries the disabled state");
  return marked.reduce((a, b) => (a.start <= b.start ? a : b)).html;
}
