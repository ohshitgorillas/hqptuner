// cava's northern lights shader and its pass-through vertex shader, ported from GLSL 330 to GLSL ES 3.00 for WebGL2.
//
// Source: output/shaders/northern_lights.frag and output/shaders/pass_through.vert,
// https://github.com/karlstav/cava/blob/master/output/shaders/northern_lights.frag
// MIT, see ../cava-LICENSE.txt
//
// Neither string carries its `#version` line: the importer prepends `#version 300 es`, and before the fragment shader
// also `#define BANDS <n>`, the length of `bars`. The fragment shader writes cava's colour premultiplied, its alpha
// the brightest channel, so where cava draws black the page behind shows through.

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

uniform vec3 fg_color;

void main()
{
    int bar = min(int(float(bars_count) * fragCoord.x), bars_count - 1);

    float bar_y = 1.0 - abs((fragCoord.y - 0.5)) * 2.0;
    float y = (bars[bar]) * bar_y;

    float bar_x = (fragCoord.x - float(bar) / float(bars_count)) * float(bars_count);
    float bar_r = 1.0 - abs((bar_x - 0.5)) * 2.0;

    bar_r = bar_r * bar_r * 2.0;

    vec3 colour = clamp(fg_color * y * bar_r, 0.0, 1.0);
    fragColor = vec4(colour, max(colour.r, max(colour.g, colour.b)));
}
`;
