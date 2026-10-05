# PyInstaller build of the frozen bundle: pyinstaller hqptuner.spec, which
# scripts/package-linux.sh runs before packing the deb and the rpm,
# scripts/package-macos.sh before packing the dmg, and
# scripts/package-windows.sh before packing the installer.
#
# One-folder, so the assets land beside the executable rather than in a temp
# directory that goes away at exit. The bundle destinations are "static" and
# "data" at the bundle root, with no "hqptuner/" prefix, because that is what
# makes hqptuner/paths.py:bundled() agree with itself in both cases: unfrozen it
# returns hqptuner/static and hqptuner/data, frozen it returns _MEIPASS/static
# and _MEIPASS/data.
#
# The hidden imports are uvicorn's runtime string-keyed lookups
# (uvicorn/config.py HTTP_PROTOCOLS, WS_PROTOCOLS, LIFESPAN, LOOP_FACTORIES,
# each reached through import_from_string). No `import` statement points at
# them, so a static analyzer sees no edge and the binary fails at launch rather
# than at build.

import sys
import tomllib
from pathlib import Path

a = Analysis(
    ["hqptuner/__main__.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("hqptuner/static", "static"),
        # data/ member by member rather than the whole directory, matching the
        # package-data globs in pyproject.toml: engine-enums.json is the captured
        # engine snapshot that scripts/gates/check_metadata.py reads at
        # development time, nothing under hqptuner/ opens it, and a wheel install
        # does not carry it either.
        ("hqptuner/data/filters.json", "data"),
        ("hqptuner/data/shapers.json", "data"),
        ("hqptuner/data/settings.json", "data"),
        ("hqptuner/data/easy-presets.json", "data"),
        ("hqptuner/data/tray.png", "data"),
        ("hqptuner/data/*-plain-names.json", "data"),
    ],
    hiddenimports=[
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        # hqptuner/desktop.py loads the tray backend by name, and only macOS and
        # Windows installs carry it.
        *(["pystray", "PIL.Image"] if sys.platform != "linux" else []),
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="HQPTuner",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # A macOS or Windows launch has no terminal behind it: the app lives in the
    # menu bar or the tray.
    console=sys.platform == "linux",
    # Not an ico: PyInstaller converts it with Pillow, which a Windows install
    # already carries for the tray. The macOS icon is set on the bundle below.
    icon=str(Path(SPECPATH, "packaging/desktop/icon.png")) if sys.platform == "win32" else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="HQPTuner",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="HQPTuner.app",
        # Not an icns: PyInstaller converts it with Pillow, which a macOS
        # install already carries for the tray.
        icon=str(Path(SPECPATH, "packaging/desktop/icon.png")),
        bundle_identifier="net.ohshitgorillas.hqptuner",
        version=tomllib.loads(Path(SPECPATH, "pyproject.toml").read_text())["project"]["version"],
        info_plist={
            # Menu bar only, no Dock icon.
            "LSUIElement": True,
            # A frozen bundle supports the macOS it was built on and later, and
            # .github/workflows/release.yml builds on macOS 15.
            "LSMinimumSystemVersion": "15.0",
            # The text of the system's local network alert, which the daemon
            # connection and discovery both raise on a launch from Finder.
            "NSLocalNetworkUsageDescription": (
                "HQPTuner connects to and controls HQPlayer Embedded over the local network."
            ),
        },
    )
