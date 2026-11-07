// The daemon's /speakers form as the server parses it, shared by the rendered Speakers suites: eight channels, each
// with HQPlayer's stock level of 0 and the distance a case hands in, the switch on.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

//: The channel labels the daemon's form carries, in its channel order.
export const SPEAKER_LABELS = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];

//: A distance per channel, in centimeters, each off HQPlayer's stock 0.
export const SPEAKER_DISTANCES = [287, 301, 280, 330, 240, 241, 210, 211];

/**
 * The daemon's /speakers form with these distances and every level at HQPlayer's stock 0.
 *
 * @param {number[]} distances
 */
export const speakersFormAt = (distances) => ({
  enabled: true,
  channels: SPEAKER_LABELS.map((label, index) => ({
    index,
    label,
    level: 0,
    distance: distances[index],
    level_min: -60,
    level_max: 0,
    level_step: 0.1,
    distance_min: 0,
    distance_max: 5000,
  })),
});
