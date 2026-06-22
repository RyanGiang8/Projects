#!/usr/bin/env python3
"""
Scans Media/<Category> folders, compresses any oversized photos with sips,
and regenerates the photosByCategory/tabs block in photography.html to match
exactly what's on disk.

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
MEDIA = ROOT / "photography.html"
MEDIA_DIR = ROOT / "Media"

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
SKIP_DIRS = {"Video", "Projects"}  # not photography categories (raw video, project-card screenshots)
MAX_DIMENSION = 2000
JPEG_QUALITY = 80

# Preferred tab order for known categories; anything new is appended
# alphabetically after these.
PREFERRED_ORDER = [
    "Automotive", "Landscape", "Astrophotography", "Portrait", "Street", "Corporate"
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

    html = MEDIA.read_text()
    pattern = re.compile(
        r"/\* AUTO-GENERATED:START.*?AUTO-GENERATED:END \*/",
        re.DOTALL
    )
    if not pattern.search(html):
        sys.exit(f"Could not find AUTO-GENERATED markers in {MEDIA.name}")

    new_block = render_block(categories)
    html = pattern.sub(new_block, html, count=1)
    MEDIA.write_text(html)
    print(f"\n{MEDIA.name} updated.")


if __name__ == "__main__":
    main()
