# Copyright (c) 2026 siwekpio
# SPDX-License-Identifier: GPL-3.0-only
"""Local filename guard; the real strict hassfest check also runs in CI."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

BRAND = Path(__file__).resolve().parents[1] / "custom_components" / "req_rekuperator" / "brand"
ALLOWED = frozenset({
    "icon.png", "icon@2x.png", "logo.png", "logo@2x.png",
    "dark_icon.png", "dark_icon@2x.png", "dark_logo.png", "dark_logo@2x.png",
})
REQUIRED = frozenset({"icon.png", "icon@2x.png"})


def brand_errors(directory: Path) -> list[str]:
    if not directory.is_dir():
        return ["Missing brand directory"]
    errors = []
    for path in sorted(directory.iterdir()):
        if path.name not in ALLOWED or not path.is_file() or path.is_symlink():
            errors.append(f"Unexpected brand entry: {path.name}")
    for name in sorted(REQUIRED):
        if not (directory / name).is_file():
            errors.append(f"Missing project icon: {name}")
    return errors


class BrandImagesTests(unittest.TestCase):
    def test_repository_brand(self):
        self.assertEqual(brand_errors(BRAND), [])

    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.brand = Path(temp.name) / "brand"
        self.brand.mkdir()
        for name in REQUIRED:
            (self.brand / name).touch()

    def test_allowed_names(self):
        for name in ALLOWED:
            (self.brand / name).touch()
        self.assertEqual(brand_errors(self.brand), [])

    def test_legacy_brand_documents_rejected(self):
        for name in ("BRANDING.md", "BRANDING.en.md"):
            (self.brand / name).touch()
        self.assertEqual(brand_errors(self.brand), [
            "Unexpected brand entry: BRANDING.en.md", "Unexpected brand entry: BRANDING.md",
        ])

    def test_unknown_image_rejected(self):
        (self.brand / "extra.png").touch()
        self.assertEqual(brand_errors(self.brand), ["Unexpected brand entry: extra.png"])

    def test_directory_rejected(self):
        (self.brand / "logo.png").mkdir()
        self.assertEqual(brand_errors(self.brand), ["Unexpected brand entry: logo.png"])

    def test_missing_required_icon_rejected(self):
        (self.brand / "icon.png").unlink()
        self.assertEqual(brand_errors(self.brand), ["Missing project icon: icon.png"])
