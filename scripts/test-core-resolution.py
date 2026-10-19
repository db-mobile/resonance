"""Regression checks for the standalone/desktop dependency guard."""
import contextlib
import importlib.util
import io
import re
import shutil
import tempfile
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('resolution', Path(__file__).with_name('check-core-resolution.py'))
resolution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolution)


class ResolutionCheck(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_root = resolution.ROOT
        root = Path(self.temp.name)
        for relative in ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
                         'crates/resonance-core/Cargo.toml', 'crates/resonance-core/Cargo.lock']:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.original_root / relative, target)
        resolution.ROOT = root

    def tearDown(self):
        resolution.ROOT = self.original_root
        self.temp.cleanup()

    def test_matching_resolution_passes(self):
        with contextlib.redirect_stdout(io.StringIO()):
            resolution.check()

    def test_core_version_drift_fails(self):
        path = resolution.ROOT / 'crates/resonance-core/Cargo.toml'
        path.write_text(re.sub(r'version = "[^"]+"', 'version = "0.0.0"', path.read_text(), count=1))
        with self.assertRaisesRegex(AssertionError, 'versions must agree'):
            resolution.check()

    def test_direct_resolution_drift_fails(self):
        path = resolution.ROOT / 'crates/resonance-core/Cargo.lock'
        path.write_text(re.sub(r'(name = "encoding_rs"\nversion = )"[^"]+"', r'\1"0.0.0"', path.read_text(), count=1))
        with self.assertRaisesRegex(AssertionError, 'resolutions differ'):
            resolution.check()


if __name__ == '__main__':
    unittest.main()
