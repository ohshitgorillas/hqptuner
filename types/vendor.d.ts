// Ambient declarations for the importmap's bare specifiers.
//
// The frontend has no build step: index.html's importmap resolves "preact",
// "htm" and the signals packages to vendored bundles under static/vendor/.
// tsc cannot follow an importmap, so without help every such import is TS2307.
//
// Pointing `paths` at the vendored bundles does resolve them — but it also
// pulls those bundles INTO the program, and tsc then type-checks upstream's
// minified output (48 errors, none of them ours). `exclude` does not govern
// files reached by import, and skipLibCheck/maxNodeModuleJsDepth do not apply,
// so there is no config-only way to resolve-but-not-check them.
//
// Declaring the modules ambiently resolves the specifiers without loading the
// bundles at all. The vendored files stay pristine — they are upstream copies,
// and an edit there would be silently lost on the next re-vendor.
//
// The cost, stated plainly: these modules type as `any`, so preact's own API is
// unchecked. That matches the loose `checkJs` tier this project chose — the
// value is in checking OUR modules, which stay fully checked. Typed packages
// from npm were the alternative and were rejected: the vendored bundles carry
// no version markers, so the .d.ts versions could not be verified to match, and
// a mismatched declaration reports errors that are confidently wrong.

declare module "preact";
declare module "preact/hooks";
declare module "@preact/signals";
declare module "@preact/signals-core";
declare module "htm";
