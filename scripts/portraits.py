"""
Portraits for lists that want a face without a renderer: the starter
picker, the mini-game reaction. Each one is the species' idle frame from
the render audit (`scripts/species-render-audit.py`, 300x360 with the
creature framed by the same camera as Home), cropped to a square around
the head and shoulders and saved small as WebP.

    python3 -I scripts/portraits.py test-results/species-audit/<date>/render/img .pokedex-cache/portraits

In production the output folder lives on the data volume next to the
pokedex cache, and `/api/assets/portraits/<species>` serves it.
"""

import sys
from pathlib import Path

from PIL import Image

SIZE = 112
# The audit camera puts the head in the upper middle of the frame for a
# creature of any height; this square keeps it and drops the feet.
CROP = (40, 50, 260, 270)


def main(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    done = 0
    for png in sorted(src.glob("*-idle.png")):
        species = png.name[: -len("-idle.png")]
        with Image.open(png) as im:
            im = im.convert("RGB").crop(CROP).resize((SIZE, SIZE), Image.LANCZOS)
            im.save(out / f"{species}.webp", "WEBP", quality=82, method=6)
        done += 1
    print(f"{done} portraits in {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
