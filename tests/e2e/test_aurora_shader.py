"""The aurora spectrum's fragment shader, run on a real WebGL2 context.

The unit is `NORTHERN_LIGHTS_FRAG` with `PASS_THROUGH_VERT`, both exported by
`hqptuner/static/vendor/cava/northern_lights.js` and loaded from the running
stack's static server. Each test compiles them the way the page's aurora painter
does (`#version 300 es`, and `#define BANDS <n>` and `#define STOPS <n>` ahead of
the fragment shader), draws one full-canvas quad over a transparent clear with
the uniforms `bars`, `bars_count` and `ramp` set, and reads pixels back. The
shader writes its colour premultiplied and its alpha is its brightest channel,
so the alpha is the brightness and the colour channels are the hue.

Policy notes:

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

#: The pixel row whose centre lies half way up the plot.
MIDDLE_ROW = 80

#: The pixel column whose centre lies on the boundary between bands 3 and 4.
EDGE_COLUMN = 80

#: The pixel column at the centre of band 3: 3.5 * 161 / 8 = 70.4.
CENTRE_COLUMN = 70

#: The pixel column at the centre of band 1, inside the left half: 1.5 * 161 / 8 = 30.2.
LEFT_HALF_COLUMN = 30

#: The pixel column at the centre of band 6, inside the right half: 6.5 * 161 / 8 = 130.8.
RIGHT_HALF_COLUMN = 130

#: A ramp whose stops are all white, so brightness alone varies with level.
WHITE_RAMP = [1.0, 1.0, 1.0] * 3

#: A ramp from red at the floor through green to blue at full scale, so how far
#: up the ramp a pixel sits reads as how much of it is blue.
RGB_RAMP = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]

#: Components per ramp stop.
RGB = 3

#: The channel of `RGB_RAMP`'s top stop.
BLUE = 2

#: A level two percent of full scale: quiet.
QUIET_LEVEL = 0.02

#: A level five percent of full scale: faint, above the quiet floor.
FAINT_LEVEL = 0.05

#: A level forty percent of full scale.
MODERATE_LEVEL = 0.4

#: A level ninety percent of full scale: loud.
LOUD_LEVEL = 0.9

#: The darkest alpha byte a full glow at the band centre reads: the centre pixel
#: sits 0.06 px off the band's middle, which costs it under one percent, and
#: 8-bit rounding costs it under one more byte.
FULL_GLOW_FLOOR = 250

#: Compiles the pair, draws once and answers the RGBA bytes at each column, on one row.
DRAW_JS = """
async ({ url, bands, size, levels, ramp, columns, row }) => {
  const { NORTHERN_LIGHTS_FRAG, PASS_THROUGH_VERT } = await import(url);
  const stops = ramp.length / 3;
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
    compile(
      gl.FRAGMENT_SHADER,
      "#version 300 es\\n#define BANDS " + bands + "\\n#define STOPS " + stops + "\\n" + NORTHERN_LIGHTS_FRAG,
    ),
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
  gl.uniform3fv(gl.getUniformLocation(program, "ramp"), new Float32Array(ramp));
  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return columns.map((column) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(column, row, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  });
}
"""


def _pixels(
    page: Page, stack: stack_support.Stack, levels: list[float], ramp: list[float], columns: list[int]
) -> list[list[int]]:
    """The RGBA bytes one draw writes at each of `columns`, half way up, with the bands at `levels`."""
    url = f"{stack.base_url}{MODULE_PATH}"
    page.goto(url)
    args: dict[str, Any] = {
        "url": url,
        "bands": BANDS,
        "size": SIZE,
        "levels": levels,
        "ramp": ramp,
        "columns": columns,
        "row": MIDDLE_ROW,
    }
    return [[int(byte) for byte in pixel] for pixel in page.evaluate(DRAW_JS, args)]


def _alphas(page: Page, stack: stack_support.Stack, levels: list[float], columns: list[int]) -> list[int]:
    """The brightness bytes one draw writes at each of `columns`, half way up, with a white ramp."""
    return [pixel[RGB] for pixel in _pixels(page, stack, levels, WHITE_RAMP, columns)]


def _alpha(page: Page, stack: stack_support.Stack, level: float, column: int) -> int:
    """The brightness byte the shader writes at `column`, half way up, with a white ramp and every band at `level`."""
    return _alphas(page, stack, [level] * BANDS, [column])[0]


def _top_share(page: Page, stack: stack_support.Stack, level: float) -> float:
    """The share of the band centre's colour that is the RGB ramp's top stop, with every band at `level`."""
    colour = _pixels(page, stack, [level] * BANDS, RGB_RAMP, [CENTRE_COLUMN])[0][:RGB]
    return colour[BLUE] / sum(colour)


def test_quiet_column_stays_dark_where_a_loud_one_lights(page: Page, stack: stack_support.Stack) -> None:
    """In one plot with its left half quiet and its right half loud, only the loud half lights."""
    levels = [QUIET_LEVEL] * (BANDS // 2) + [LOUD_LEVEL] * (BANDS // 2)
    alphas = _alphas(page, stack, levels, [LEFT_HALF_COLUMN, RIGHT_HALF_COLUMN])
    assert [alpha > 0 for alpha in alphas] == [False, True]


def test_loud_column_glows_at_full_brightness(page: Page, stack: stack_support.Stack) -> None:
    """A loud column glows at full brightness at its centre, half way up."""
    assert _alpha(page, stack, LOUD_LEVEL, CENTRE_COLUMN) >= FULL_GLOW_FLOOR


def test_faint_column_glows_dimmer_than_loud_one(page: Page, stack: stack_support.Stack) -> None:
    """A column just above the quiet floor fades in rather than jumping straight to full glow."""
    faint = _alpha(page, stack, FAINT_LEVEL, CENTRE_COLUMN)
    loud = _alpha(page, stack, LOUD_LEVEL, CENTRE_COLUMN)
    assert faint < loud


def test_louder_column_takes_colour_further_up_the_ramp(page: Page, stack: stack_support.Stack) -> None:
    """The colour is sampled from the ramp by level, so a louder column sits nearer the ramp's top stop."""
    louder = _top_share(page, stack, LOUD_LEVEL)
    quieter = _top_share(page, stack, MODERATE_LEVEL)
    assert louder > quieter


def test_column_edge_is_dimmer_than_its_centre(page: Page, stack: stack_support.Stack) -> None:
    """Across a column, brightness falls from its centre towards the edge it shares with the next band."""
    edge, centre = _alphas(page, stack, [LOUD_LEVEL] * BANDS, [EDGE_COLUMN, CENTRE_COLUMN])
    assert edge < centre
