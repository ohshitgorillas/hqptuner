"""The aurora spectrum's fragment shader, run on a real WebGL2 context.

The unit is `NORTHERN_LIGHTS_FRAG` with `PASS_THROUGH_VERT`, both exported by
`hqptuner/static/vendor/cava/northern_lights.js` and loaded from the running
stack's static server. Each test compiles them the way the page's aurora painter
does (`#version 300 es`, and `#define BANDS <n>` ahead of the fragment shader),
draws one full-canvas quad over a transparent clear with the uniforms `bars`,
`bars_count` and `fg_color` set, and reads one pixel back. The shader's output
alpha is its brightest colour channel, so the alpha is the brightness.

Policy notes (docs/testing.md):

- One assertion per test; the helper returns the pixel and the test judges it.
- GLSL runs only in a real WebGL2 context, so this is the browser lane. The
  browser fixture launches chromium on swiftshader for that.
- Nothing here waits: the draw and the readback are synchronous in the page.
"""

from typing import Any

from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: Where the stack serves the shader module.
MODULE_PATH = "/vendor/cava/northern_lights.js"

#: The band count, both the `BANDS` array size and `bars_count`.
BANDS = 8

#: An odd canvas size puts both the boundary between bands 3 and 4 and the
#: vertical middle on the centre of a pixel: 4 * 161 / 8 = 80.5 = 161 / 2.
SIZE = 161

#: The lower band of the boundary pair, well away from both ends of the plot.
LEFT_BAND = 3

#: The pixel column and row whose centre lies on the boundary and at half height.
BOUNDARY_COLUMN = 80
MIDDLE_ROW = 80

#: The pixel column at the centre of band `LEFT_BAND`: 3.5 * 161 / 8 = 70.4.
BAND_CENTRE_COLUMN = 70

#: Level of the two lit neighbours in the boundary case.
HALF = 0.5

#: A colour dim enough that no channel clamps at the levels below.
DIM = (0.2, 0.2, 0.2)

#: Full colour, for the cases that read whether a pixel is lit or saturated.
BRIGHT = (1.0, 1.0, 1.0)

#: The two levels whose brightnesses are compared; a linear response gives 4.
HIGH_LEVEL = 0.4
LOW_LEVEL = 0.1

#: The linear ratio less what 8-bit rounding of both readings can take off it
#: when the dimmer one reads 6 or more: (4 * 6 - 0.5) / (6 + 0.5) = 3.6.
CONCAVE_CEILING = 3.6

#: What 8-bit rounding can take off "boundary >= centre / 2": half a step on
#: the boundary plus half of half a step on the centre, 0.75, taken up to 1.
SEAM_ROUNDING = 1

#: Two levels below full scale, both high enough that a clamping response
#: saturates on them at full colour.
UPPER_LEVEL = 0.9
LOWER_LEVEL = 0.6

#: Compiles the pair, draws once and answers the alpha byte at each column, on one row.
DRAW_JS = """
async ({ url, bands, size, levels, colour, columns, row }) => {
  const { NORTHERN_LIGHTS_FRAG, PASS_THROUGH_VERT } = await import(url);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new Error("no WebGL2 context");
  const compile = (kind, source) => {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, "#version 300 es\\n" + PASS_THROUGH_VERT));
  gl.attachShader(
    program,
    compile(gl.FRAGMENT_SHADER, "#version 300 es\\n#define BANDS " + bands + "\\n" + NORTHERN_LIGHTS_FRAG),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const attributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributes; i++) {
    const location = gl.getAttribLocation(program, gl.getActiveAttrib(program, i).name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }
  gl.uniform1fv(gl.getUniformLocation(program, "bars"), new Float32Array(levels));
  gl.uniform1i(gl.getUniformLocation(program, "bars_count"), levels.length);
  gl.uniform3f(gl.getUniformLocation(program, "fg_color"), colour[0], colour[1], colour[2]);
  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return columns.map((column) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(column, row, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[3];
  });
}
"""


def _alphas(
    page: Page,
    stack: stack_support.Stack,
    levels: list[float],
    colour: tuple[float, float, float],
    columns: list[int],
) -> list[int]:
    """The alpha bytes one draw writes at each of `columns`, half way up, for one set of band levels."""
    url = f"{stack.base_url}{MODULE_PATH}"
    page.goto(url)
    args: dict[str, Any] = {
        "url": url,
        "bands": BANDS,
        "size": SIZE,
        "levels": levels,
        "colour": list(colour),
        "columns": columns,
        "row": MIDDLE_ROW,
    }
    return [int(alpha) for alpha in page.evaluate(DRAW_JS, args)]


def _alpha(
    page: Page, stack: stack_support.Stack, levels: list[float], colour: tuple[float, float, float], column: int
) -> int:
    """The alpha byte the shader writes at `column`, half way up, for one set of band levels."""
    return _alphas(page, stack, levels, colour, [column])[0]


def _two_lit_neighbours() -> list[float]:
    """Every band dark but `LEFT_BAND` and the one after it, both at half level."""
    levels = [0.0] * BANDS
    levels[LEFT_BAND] = HALF
    levels[LEFT_BAND + 1] = HALF
    return levels


def test_the_boundary_between_two_lit_neighbouring_bands_is_half_as_bright_as_their_centre(
    page: Page, stack: stack_support.Stack
) -> None:
    """Neighbouring bands blend and column edges are soft, so the seam between two equal bands is half their centre."""
    boundary, centre = _alphas(page, stack, _two_lit_neighbours(), BRIGHT, [BOUNDARY_COLUMN, BAND_CENTRE_COLUMN])
    assert boundary >= centre / 2 - SEAM_ROUNDING


def test_brightness_rises_more_slowly_than_level(page: Page, stack: stack_support.Stack) -> None:
    """Brightness follows a concave power curve of level: quadrupling the level less than quadruples it."""
    high = _alpha(page, stack, [HIGH_LEVEL] * BANDS, DIM, BAND_CENTRE_COLUMN)
    low = _alpha(page, stack, [LOW_LEVEL] * BANDS, DIM, BAND_CENTRE_COLUMN)
    assert high / low < CONCAVE_CEILING


def test_brightness_keeps_rising_below_full_scale(page: Page, stack: stack_support.Stack) -> None:
    """Below full scale a louder level is brighter at full colour, so the response has not clamped."""
    upper = _alpha(page, stack, [UPPER_LEVEL] * BANDS, BRIGHT, BAND_CENTRE_COLUMN)
    lower = _alpha(page, stack, [LOWER_LEVEL] * BANDS, BRIGHT, BAND_CENTRE_COLUMN)
    assert upper > lower
