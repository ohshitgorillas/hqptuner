// Shared /config form rows of the rendered mode-drawer suites (tests/js/components/faceplate-drawers/): each chain's
// 1x and Nx filter select, as the daemon's form carries them.

/**
 * @typedef {object} ChainFilters
 * @property {string} pcm1x  the PCM chain's 1x filter value
 * @property {string} pcmnx  the PCM chain's Nx filter value
 * @property {string} sdm1x  the SDM chain's 1x filter value
 * @property {string} sdmnx  the SDM chain's Nx filter value
 */

/**
 * The /config form's four filter selects, PCM 1x and Nx then SDM 1x and Nx, each at its value and offering `options`.
 *
 * @param {ChainFilters} f
 * @param {{ value: string, label: string }[]} options
 */
export const filterFields = ({ pcm1x, pcmnx, sdm1x, sdmnx }, options) => [
  { name: "filter1x", type: "select", value: pcm1x, options },
  { name: "filter", type: "select", value: pcmnx, options },
  { name: "oversampling1x", type: "select", value: sdm1x, options },
  { name: "oversampling", type: "select", value: sdmnx, options },
];
