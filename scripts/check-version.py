#!/usr/bin/env python3
"""The workspace version is the one shipped version.

package.json, the Cargo workspace and tauri.conf.json must agree, and no
workspace member may declare its own version, because the User-Agent, the
updater manifest and the release artefact names are all derived from it.
"""
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEMBERS = ['src-tauri', 'crates/resonance-core', 'crates/resonance-collections', 'crates/resonance-cli']


def check():
    workspace = tomllib.loads((ROOT / 'Cargo.toml').read_text())['workspace']['package']['version']
    package = json.loads((ROOT / 'package.json').read_text())['version']
    tauri = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())['version']
    assert package == workspace == tauri, f'versions differ: package.json={package} Cargo workspace={workspace} tauri.conf.json={tauri}'
    for member in MEMBERS:
        manifest = ROOT / member / 'Cargo.toml'
        if not manifest.exists():
            continue
        declared = tomllib.loads(manifest.read_text())['package'].get('version')
        assert declared == {'workspace': True}, f'{member} must inherit version.workspace = true, found {declared!r}'
    print(f'Version {workspace} agrees across package.json, the Cargo workspace and tauri.conf.json.')


if __name__ == '__main__':
    check()
