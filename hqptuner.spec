# PyInstaller build of the desktop binary: pyinstaller hqptuner.spec
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
        ("hqptuner/data/*-plain-names.json", "data"),
    ],
    hiddenimports=[
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
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
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="HQPTuner",
)
