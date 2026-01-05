from __future__ import annotations

import io
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


OG_WIDTH = 1200
OG_HEIGHT = 630


Font = ImageFont.FreeTypeFont | ImageFont.ImageFont


def _load_font(size: int, *, bold: bool = False) -> Font:
    candidates = []
    if bold:
        candidates.extend(
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            ]
        )
    else:
        candidates.extend(
            [
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ]
        )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_blog_post_og(*, title: str, subtitle: str | None = None, brand: str = "Moment Studio") -> bytes:
    title = (title or "").strip() or "Blog"
    subtitle = (subtitle or "").strip() or ""

    bg_top = (2, 6, 23)  # slate-950-ish
    bg_bottom = (15, 23, 42)  # slate-900-ish
    accent = (129, 140, 248)  # indigo-300-ish
    text_primary = (248, 250, 252)  # slate-50-ish
    text_secondary = (203, 213, 225)  # slate-300-ish

    img = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), bg_top)
    draw = ImageDraw.Draw(img)
    for y in range(OG_HEIGHT):
        t = y / max(1, OG_HEIGHT - 1)
        r = int(bg_top[0] * (1 - t) + bg_bottom[0] * t)
        g = int(bg_top[1] * (1 - t) + bg_bottom[1] * t)
        b = int(bg_top[2] * (1 - t) + bg_bottom[2] * t)
        draw.line((0, y, OG_WIDTH, y), fill=(r, g, b))

    margin = 80
    draw.text((margin, 70), brand, fill=text_secondary, font=_load_font(36, bold=True))
    draw.line((margin, 120, margin + 240, 120), fill=accent, width=6)

    max_text_width = OG_WIDTH - margin * 2
    title_font_size = 74
    title_font = _load_font(title_font_size, bold=True)

    def fits(lines: list[str], font: Font) -> bool:
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            if bbox[2] - bbox[0] > max_text_width:
                return False
        return True

    lines = wrap(title, width=28) or [title]
    while (len(lines) > 3 or not fits(lines, title_font)) and title_font_size > 44:
        title_font_size -= 4
        title_font = _load_font(title_font_size, bold=True)
        lines = wrap(title, width=max(18, int(28 * (74 / title_font_size)))) or [title]

    y = 165
    for line in lines[:3]:
        draw.text((margin, y), line, fill=text_primary, font=title_font)
        y += title_font_size + 10

    if subtitle:
        subtitle_font = _load_font(34, bold=False)
        subtitle_lines = wrap(subtitle, width=46)[:2]
        y += 18
        for line in subtitle_lines:
            draw.text((margin, y), line, fill=text_secondary, font=subtitle_font)
            y += 44

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
