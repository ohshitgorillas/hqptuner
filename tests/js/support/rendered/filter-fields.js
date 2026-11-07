// Shared /config form rows of the rendered mode-drawer suites (tests/js/components/faceplate-drawers/): each chain's
// 1x and Nx filter select, as the daemon's form carries them, and the values those selects show.

/**
 * @typedef {object} ChainFilters
 * @property {string} pcm1x  the PCM chain's 1x filter value, shown by the `filter1x` field
 * @property {string} pcmnx  the PCM chain's Nx filter value, shown by the `filter` field
 * @property {string} sdm1x  the SDM chain's 1x filter value, shown by the `oversampling1x` field
 * @property {string} sdmnx  the SDM chain's Nx filter value, shown by the `oversampling` field
 */

/**
 * The /config form's four filter selects, PCM 1x and Nx then SDM 1x and Nx, each offering `options`: `fields` are the
 * form's rows, name, type and options only, for `config.value`; `values` are the four values keyed by the served field
 * name, for the caller's one `seedReadings` call.
 *
 * @param {ChainFilters} f
 * @param {{ value: string, label: string }[]} options
 */
export const filterFields = ({ pcm1x, pcmnx, sdm1x, sdmnx }, options) => ({
  fields: [
    { name: "filter1x", type: "select", options },
    { name: "filter", type: "select", options },
    { name: "oversampling1x", type: "select", options },
    { name: "oversampling", type: "select", options },
  ],
  values: { filter1x: pcm1x, filter: pcmnx, oversampling1x: sdm1x, oversampling: sdmnx },
});
