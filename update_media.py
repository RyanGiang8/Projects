#!/usr/bin/env python3
"""
Scans Media/<Category> folders, compresses any oversized photos with sips,
then regenerates BOTH photography surfaces to match exactly what's on disk:

  * photography-galleries.html — the photosByCategory/tabs block
    (categorised masonry galleries)
  * assets/gallery/ + photography.html — web-sized thumbnails and the
    GALLERY_IMAGES array powering the 3D landing gallery

Usage:
    python3 update_media.py

To add a photo:    drop the file into Media/<Category>/, then run this script.
To remove a photo: delete the file from Media/<Category>/, then run this script.
To add a category: create a new Media/<NewFolder>/ directory with photos in it,
                    then run this script (it's appended to the end of the tabs).
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
GALLERIES = ROOT / "photography-galleries.html"
LANDING = ROOT / "photography.html"
THUMB_DIR = ROOT / "assets" / "gallery"
THUMB_MAX = 800
THUMB_QUALITY = 60
MEDIA_DIR = ROOT / "Media"

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
SKIP_DIRS = {"Video", "Projects"}  # not photography categories (raw video, project-card screenshots)
MAX_DIMENSION = 2000
JPEG_QUALITY = 80

# Preferred tab order for known categories; anything new is appended
# alphabetically after these.
PREFERRED_ORDER = [
    "Automotive", "Landscape", "Portrait", "Street", "Astrophotography", "Corporate"
]


def sips_dimensions(path: Path):
    out = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        capture_output=True, text=True
    ).stdout
    width = height = 0
    for line in out.splitlines():
        if "pixelWidth" in line:
            width = int(line.split(":")[1].strip())
        elif "pixelHeight" in line:
            height = int(line.split(":")[1].strip())
    return width, height


def compress_if_needed(path: Path):
    width, height = sips_dimensions(path)
    if max(width, height) <= MAX_DIMENSION:
        return False
    before = path.stat().st_size
    subprocess.run(
        ["sips", "-Z", str(MAX_DIMENSION), "-s", "formatOptions", str(JPEG_QUALITY), str(path)],
        capture_output=True
    )
    after = path.stat().st_size
    print(f"  compressed {path.relative_to(ROOT)}: {before/1024:.0f}KB -> {after/1024:.0f}KB")
    return True


def discover_categories():
    categories = []
    for d in sorted(MEDIA_DIR.iterdir()):
        if not d.is_dir() or d.name in SKIP_DIRS:
            continue
        files = sorted(
            f.name for f in d.iterdir()
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS
        )
        if files:
            categories.append((d.name, files))

    def sort_key(item):
        folder = item[0]
        if folder in PREFERRED_ORDER:
            return (0, PREFERRED_ORDER.index(folder))
        return (1, folder.lower())

    categories.sort(key=sort_key)
    return categories


def render_block(categories):
    lines = []
    lines.append("/* AUTO-GENERATED:START — do not hand-edit; run `python3 update_media.py` instead */")
    lines.append("const photosByCategory = {")
    for i, (folder, files) in enumerate(categories):
        key = folder.lower()
        file_list = ",".join(f"'{f}'" for f in files)
        comma = "," if i < len(categories) - 1 else ""
        lines.append(f"  {key}: buildCategory('{folder}', [{file_list}]){comma}")
    lines.append("};")
    lines.append("")
    lines.append("const tabs = [")
    for i, (folder, _files) in enumerate(categories):
        key = folder.lower()
        comma = "," if i < len(categories) - 1 else ""
        lines.append(f"  {{ id:'{key}', label:'{folder}' }}{comma}")
    lines.append("];")
    lines.append("/* AUTO-GENERATED:END */")
    return "\n".join(lines)


def sync_thumbnails(categories):
    """Mirror Media/ into assets/gallery/ as small web-sized JPEGs.

    The 3D gallery uploads every image as a WebGL texture, so it needs
    small files — full-resolution originals would blow out VRAM and
    bandwidth. Thumbnails are generated on demand and stale ones pruned.
    """
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    expected = {}
    for folder, files in categories:
        for f in files:
            src = MEDIA_DIR / folder / f
            thumb = THUMB_DIR / (Path(f).stem + ".jpg")
            expected[thumb.name] = (src, folder)

    made = 0
    for name, (src, _folder) in expected.items():
        thumb = THUMB_DIR / name
        if thumb.exists() and thumb.stat().st_mtime >= src.stat().st_mtime:
            continue
        subprocess.run(
            ["sips", "-Z", str(THUMB_MAX), "-s", "format", "jpeg",
             "-s", "formatOptions", str(THUMB_QUALITY), str(src), "--out", str(thumb)],
            capture_output=True
        )
        made += 1

    removed = 0
    for existing in THUMB_DIR.glob("*.jpg"):
        if existing.name not in expected:
            existing.unlink()
            removed += 1

    print(f"Thumbnails: {made} generated, {removed} pruned, {len(expected)} total.")
    return expected


def render_landing_array(expected):
    """Interleave categories so the 3D tunnel mixes genres."""
    by_cat = {}
    for name, (_src, folder) in expected.items():
        by_cat.setdefault(folder, []).append(name)
    for v in by_cat.values():
        v.sort()

    order = []
    while any(by_cat.values()):
        for folder in sorted(by_cat):
            if by_cat[folder]:
                order.append((by_cat[folder].pop(0), folder))

    rows = [
        '  {src:"/assets/gallery/%s",alt:"%s photography by Ryan Giang"}' % (name, folder)
        for name, folder in order
    ]
    return "[\n" + ",\n".join(rows) + "\n]"


def replace_block(path: Path, pattern: re.Pattern, new_text: str, label: str):
    html = path.read_text()
    if not pattern.search(html):
        sys.exit(f"Could not find {label} markers in {path.name}")
    path.write_text(pattern.sub(lambda _m: new_text, html, count=1))
    print(f"{path.name} updated ({label}).")


def main():
    if not MEDIA_DIR.is_dir():
        sys.exit(f"Media directory not found at {MEDIA_DIR}")

    print("Checking for oversized images...")
    compressed_count = 0
    for d in sorted(MEDIA_DIR.iterdir()):
        if not d.is_dir() or d.name in SKIP_DIRS:
            continue
        for f in sorted(d.iterdir()):
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                if compress_if_needed(f):
                    compressed_count += 1
    print(f"Compressed {compressed_count} image(s).\n")

    categories = discover_categories()
    print("Categories found:")
    for folder, files in categories:
        print(f"  {folder}: {len(files)} photo(s)")

    print()
    replace_block(
        GALLERIES,
        re.compile(r"/\* AUTO-GENERATED:START.*?AUTO-GENERATED:END \*/", re.DOTALL),
        render_block(categories),
        "AUTO-GENERATED",
    )

    expected = sync_thumbnails(categories)
    replace_block(
        LANDING,
        re.compile(r"var GALLERY_IMAGES = \[.*?\];", re.DOTALL),
        "var GALLERY_IMAGES = " + render_landing_array(expected) + ";",
        "GALLERY_IMAGES",
    )


if __name__ == "__main__":
    main()
