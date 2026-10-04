// Stations (whole hqplayerd config; recall restarts the engine) and their Snapshots (live subset; no restart).
// Snapshots are always scoped under a station. active: currently loaded. open: tree row expanded.

export const STATIONS = [
  {
    name: 'Speakers', active: true, open: true,
    snapshots: [{ name: 'Late night', active: true }, { name: 'Daytime' }, { name: 'Vinyl rips' }],
  },
  { name: 'Headphones', snapshots: [{ name: 'Desk' }, { name: 'Bed' }] },
  { name: 'Office', snapshots: [] },
];
