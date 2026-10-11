// cava's pass-through vertex shader, ported from GLSL 330 to GLSL ES 3.00 for WebGL2, and a fragment shader adapted
// from cava's northern lights shader: each pixel's level blends between the two nearest band centres, as in cava. Where
// cava scales one colour by level in a glow centred on the plot's middle, each column here rises from the plot's floor
// to its level, the colour is sampled from a ramp of stops by the pixel's height over that level, base to crown, and the
// glow fades out through the crown and grows with the level above a knee, so quiet columns go dark. Where cava's column
// edges fall to half the centre brightness, each column here falls off over a width that grows with its level, so loud
// columns bleed into their neighbours and quiet ones narrow to threads, and that width sways in a slow wave drifting
// across the plot with `time`, the seconds the painter has drawn.
//
// Source: output/shaders/northern_lights.frag and output/shaders/pass_through.vert,
// https://github.com/karlstav/cava/blob/master/output/shaders/northern_lights.frag
// MIT, see ../cava-LICENSE.txt
//
// Neither string carries its `#version` line: the importer prepends `#version 300 es`, and before the fragment shader
// also `#define BANDS <n>`, the length of `bars`, and `#define STOPS <n>`, the length of `ramp`. The fragment shader
// writes its colour premultiplied, its alpha the brightest channel, so where it draws black the page behind shows
// through.

export const PASS_THROUGH_VERT = `
layout(location = 0) in vec3 vertexPosition_modelspace;

out vec2 fragCoord;

void main()
{
    gl_Position =  vec4(vertexPosition_modelspace, 1.0);
    fragCoord  = (vertexPosition_modelspace.xy + vec2(1.0, 1.0)) / 2.0;
}
`;

export const NORTHERN_LIGHTS_FRAG = `
precision highp float;

in vec2 fragCoord;
out vec4 fragColor;

uniform float bars[BANDS];

uniform int bars_count;

uniform vec3 ramp[STOPS];

uniform float time;

// The level at and below which a column is dark.
const float KNEE = 0.03;
// The span of level above the knee over which a column's glow rises from dark to its level's brightness.
const float FADE = 0.25;
// A column's brightness at the knee's top and at full scale, a share of the ramp's own.
const float DIM = 0.55;
const float FULL = 1.0;
// The heights, shares of a column's own, between which its glow fades out: above its level it fades in the crown's
// colour.
const float CROWN_FROM = 0.8;
const float CROWN_TO = 1.25;
// A column's half-width at the knee, in columns: its glow is gone that far from its centre.
const float WIDTH = 0.35;
// The half-width a column gains, in columns, from the knee to full scale, growing with the square of its glow's rise.
const float SPREAD = 2.5;
// The share of a column's half-width the sway adds or takes away at its crest and trough.
const float SWAY_DEPTH = 0.45;
// The sway's wavelength, a share of the plot's width.
const float SWAY_WAVELENGTH = 0.4;
// The sway's phase speed, radians/s: the wave drifts left to right one wavelength each TAU / SWAY_SPEED seconds.
const float SWAY_SPEED = 0.6;
// A full turn, radians.
const float TAU = 6.2831853;

vec3 sample_ramp(float t)
{
    float s = t * float(STOPS - 1);
    int k = clamp(int(s), 0, max(STOPS - 2, 0));
    return mix(ramp[k], ramp[min(k + 1, STOPS - 1)], clamp(s - float(k), 0.0, 1.0));
}

void main()
{
    int bar = min(int(float(bars_count) * fragCoord.x), bars_count - 1);

    float pos = float(bars_count) * fragCoord.x - 0.5;
    float pos_floor = floor(pos);
    int i0 = clamp(int(pos_floor), 0, bars_count - 1);
    int i1 = clamp(int(pos_floor) + 1, 0, bars_count - 1);
    float level = mix(bars[i0], bars[i1], smoothstep(0.0, 1.0, pos - pos_floor));

    float lit = clamp((level - KNEE) / (1.0 - KNEE), 0.0, 1.0);
    float h = fragCoord.y / max(level, 1e-4);
    float glow = smoothstep(0.0, FADE, lit) * mix(DIM, FULL, lit);
    float y = glow * (1.0 - smoothstep(CROWN_FROM, CROWN_TO, h));

    float bar_x = (fragCoord.x - float(bar) / float(bars_count)) * float(bars_count);
    float sway = 1.0 + SWAY_DEPTH * sin(TAU * fragCoord.x / SWAY_WAVELENGTH - SWAY_SPEED * time);
    float width = (WIDTH + SPREAD * lit * lit) * sway;
    float bar_r = 1.0 - smoothstep(0.0, width, abs(bar_x - 0.5));

    vec3 colour = clamp(sample_ramp(clamp(h, 0.0, 1.0)) * y * bar_r, 0.0, 1.0);
    fragColor = vec4(colour, max(colour.r, max(colour.g, colour.b)));
}
`;
