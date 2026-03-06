# -*- mode: python ; coding: utf-8 -*-
import os
import sys

block_cipher = None

# Find semgrep package location
import semgrep
semgrep_pkg = os.path.dirname(semgrep.__file__)
semgrep_bin = os.path.join(semgrep_pkg, 'bin')

a = Analysis(
    ['semgrep_entry.py'],
    pathex=[],
    binaries=[
        # Include semgrep-core.exe and all DLLs
        (os.path.join(semgrep_bin, 'semgrep-core.exe'), 'semgrep/bin'),
    ] + [
        (os.path.join(semgrep_bin, f), 'semgrep/bin')
        for f in os.listdir(semgrep_bin)
        if f.endswith('.dll')
    ],
    datas=[
        # Include semgrep data files (JSON interfaces, etc.)
        (os.path.join(semgrep_pkg, 'semgrep_interfaces'), 'semgrep/semgrep_interfaces'),
    ],
    hiddenimports=[
        'semgrep',
        'semgrep.cli',
        'semgrep.commands',
        'semgrep.commands.scan',
        'semgrep.run_scan',
        'semgrep.core_runner',
        'semgrep.config_resolver',
        'semgrep.output',
        'semgrep.formatter',
        'semgrep.formatter.json',
        'semgrep.formatter.text',
        'semgrep.rule',
        'semgrep.rule_lang',
        'semgrep.rule_match',
        'semgrep.target_manager',
        'semgrep.semgrep_core',
        'semgrep.semgrep_interfaces',
        'semgrep.engine',
        'semgrep.error',
        'semgrep.error_handler',
        'semgrep.state',
        'semgrep.env',
        'semgrep.metrics',
        'semgrep.meta',
        'semgrep.settings',
        'semgrep.constants',
        'semgrep.git',
        'semgrep.nosemgrep',
        'semgrep.autofix',
        'semgrep.scan_report',
        'semgrep.parsing_data',
        'semgrep.app',
        'semgrep.app.scans',
        'click',
        'click_option_group',
        'colorama',
        'attrs',
        'boltons',
        'boltons.iterutils',
        'glom',
        'jsonschema',
        'packaging',
        'peewee',
        'rich',
        'ruamel',
        'ruamel.yaml',
        'wcmatch',
        'wcmatch.glob',
        'requests',
        'urllib3',
        'certifi',
        'charset_normalizer',
        'idna',
        'tomli',
        'semantic_version',
        'exceptiongroup',
        'opentelemetry',
        'opentelemetry.api',
        'opentelemetry.sdk',
        'opentelemetry.trace',
        'opentelemetry.context',
        'opentelemetry.baggage',
        'opentelemetry.metrics',
        'opentelemetry.semconv',
        'opentelemetry.propagators',
        'opentelemetry.instrumentation',
        'opentelemetry.instrumentation.requests',
        'opentelemetry.instrumentation.threading',
        'opentelemetry.exporter',
        'opentelemetry.exporter.otlp',
        'opentelemetry.exporter.otlp.proto',
        'opentelemetry.exporter.otlp.proto.http',
        'opentelemetry.proto',
        'opentelemetry.proto.common',
        'opentelemetry.proto.resource',
        'opentelemetry.proto.trace',
        'google',
        'google.protobuf',
        'deprecated',
        'jwt',
        'pyjwt',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'PIL', 'Pillow', 'matplotlib', 'scipy', 'IPython',
        'notebook', 'pytest', 'tkinter', 'test',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='semgrep',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='semgrep',
)
