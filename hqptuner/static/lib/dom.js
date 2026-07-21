// Shared htm+preact binding. One `html` tagged template for every component.
// htm binds to preact's hyperscript `h`; no JSX, no build step.
import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);
