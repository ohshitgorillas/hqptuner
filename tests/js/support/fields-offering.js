// Finds a drawer field by what it offers rather than by its id: the suites over a row whose id they do not presume
// name it by its option values (`data-v`), which are the preference's own values and so contract.

import { attr, elements } from "./markup.js";

/**
 * The ids (`data-field`) of every field in rendered markup whose option buttons offer exactly `values`, in any order.
 *
 * @param {string} out
 * @param {string[]} values
 * @returns {string[]}
 */
export function fieldsOffering(out, values) {
  const want = [...values].sort().join("\n");
  return elements(out).flatMap((field) => {
    const id = attr(field, "data-field");
    if (id === undefined) return [];
    const offered = new Set(
      elements(field.html)
        .filter((e) => e.name === "button")
        .map((e) => attr(e, "data-v"))
        .filter((v) => v !== undefined),
    );
    return [...offered].sort().join("\n") === want ? [id] : [];
  });
}
