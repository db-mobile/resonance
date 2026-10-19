#!/usr/bin/env python3
"""Keep independently buildable core releases aligned with the shipped desktop graph.

The desktop lockfile remains the packaging entry point (including Flathub).
Compare resolved dependency edges, not just manifest ranges. Desktop-only feature
edges are allowed; a core edge may not resolve to a different package/version.
"""
import json
from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def read_toml(path):
    return tomllib.loads((ROOT / path).read_text())


def identity(package):
    return package['name'], package['version'], package.get('source', '')


def dependency(graph, reference):
    parts = reference.split(' ', 2)
    candidates = [p for p in graph if p['name'] == parts[0]
                  and (len(parts) == 1 or p['version'] == parts[1])
                  and (len(parts) < 3 or p.get('source') == parts[2].strip('()'))]
    if len(candidates) != 1:
        raise ValueError(f'Ambiguous lockfile dependency: {reference}')
    return identity(candidates[0])


def check():
    core_manifest = read_toml('crates/resonance-core/Cargo.toml')
    desktop_manifest = read_toml('src-tauri/Cargo.toml')
    version = json.loads((ROOT / 'package.json').read_text())['version']
    for manifest in [core_manifest, desktop_manifest]:
        assert manifest['package']['version'] == version, 'Core, desktop and frontend versions must agree (including User-Agent).'

    core = read_toml('crates/resonance-core/Cargo.lock')['package']
    desktop = read_toml('src-tauri/Cargo.lock')['package']
    shipped = {identity(p): p for p in desktop}
    core_by_id = {identity(p): p for p in core}
    core_root = next(p for p in core if p['name'] == 'resonance-core')
    desktop_root = next(p for p in desktop if p['name'] == 'resonance-core')
    normal = set(core_manifest['dependencies'])
    roots = {dependency(core, ref) for ref in core_root['dependencies'] if ref.split()[0] in normal}
    assert roots == {dependency(desktop, ref) for ref in desktop_root['dependencies']}, 'Core direct dependency resolutions differ.'
    pending, visited = list(roots), set()
    while pending:
        key = pending.pop()
        if key in visited:
            continue
        visited.add(key)
        assert key in shipped, f'Core dependency missing from desktop lockfile: {key}'
        a, b = core_by_id[key], shipped[key]
        assert a.get('checksum') == b.get('checksum'), f'Checksum mismatch: {key}'
        required = {dependency(core, ref) for ref in a.get('dependencies', [])}
        available = {dependency(desktop, ref) for ref in b.get('dependencies', [])}
        assert required <= available, f'Dependency resolution differs for {key}: {required - available}'
        pending.extend(required)
    print(f'Core and desktop agree on version {version} and {len(visited)} resolved dependencies.')


if __name__ == '__main__':
    check()
