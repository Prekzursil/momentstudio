from __future__ import annotations

import io
from textwrap import wrap

from PIL import Image, ImageDraw

from app.services.font_utils import Font, load_font as _load_font


OG_WIDTH = 1200
OG_HEIGHT = 630

def _draw_vertical_gradient(draw: ImageDraw.ImageDraw, *, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> None:
    for y in range(OG_HEIGHT):
        t = y / max(1, OG_HEIGHT - 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        draw.line((0, y, OG_WIDTH, y), fill=(r, g, b))


def _title_lines_fit(draw: ImageDraw.ImageDraw, lines: list[str], font: Font, max_text_width: int) -> bool:
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        if bbox[2] - bbox[0] > max_text_width:
            return False
    return True


def _resolve_title_layout(
    draw: ImageDraw.ImageDraw,
    *,
    title: str,
    max_text_width: int,
) -> tuple[list[str], Font, int]:
    title_font_size = 74
    title_font = _load_font(title_font_size, bold=True)
    lines = wrap(title, width=28) or [title]
    while (len(lines) > 3 or not _title_lines_fit(draw, lines, title_font, max_text_width)) and title_font_size > 44:
        title_font_size -= 4
        title_font = _load_font(title_font_size, bold=True)
        width = max(18, int(28 * (74 / title_font_size)))
        lines = wrap(title, width=width) or [title]
    return lines[:3], title_font, title_font_size


def _draw_title(
    draw: ImageDraw.ImageDraw,
    *,
    lines: list[str],
    font: Font,
    font_size: int,
    margin: int,
    color: tuple[int, int, int],
) -> int:
    y = 165
    for line in lines:
        draw.text((margin, y), line, fill=color, font=font)
        y += font_size + 10
    return y


def _draw_subtitle(
    draw: ImageDraw.ImageDraw,
    *,
    subtitle: str,
    margin: int,
    y: int,
    color: tuple[int, int, int],
) -> None:
    if not subtitle:
        return
    subtitle_font = _load_font(34, bold=False)
    subtitle_lines = wrap(subtitle, width=46)[:2]
    y += 18
    for line in subtitle_lines:
        draw.text((margin, y), line, fill=color, font=subtitle_font)
        y += 44


def render_blog_post_og(*, title: str, subtitle: str | None = None, brand: str = "momentstudio") -> bytes:
    title = (title or "").strip() or "Blog"
    subtitle = (subtitle or "").strip() or ""

    bg_top = (2, 6, 23)  # slate-950-ish
    bg_bottom = (15, 23, 42)  # slate-900-ish
    accent = (129, 140, 248)  # indigo-300-ish
    text_primary = (248, 250, 252)  # slate-50-ish
    text_secondary = (203, 213, 225)  # slate-300-ish

    img = Image.new("RGB", (OG_WIDTH, OG_HEIGHT), bg_top)
    draw = ImageDraw.Draw(img)
    _draw_vertical_gradient(draw, top=bg_top, bottom=bg_bottom)

    margin = 80
    draw.text((margin, 70), brand, fill=text_secondary, font=_load_font(36, bold=True))
    draw.line((margin, 120, margin + 240, 120), fill=accent, width=6)

    max_text_width = OG_WIDTH - margin * 2
    lines, title_font, title_font_size = _resolve_title_layout(draw, title=title, max_text_width=max_text_width)
    y = _draw_title(
        draw,
        lines=lines,
        font=title_font,
        font_size=title_font_size,
        margin=margin,
        color=text_primary,
    )
    _draw_subtitle(draw, subtitle=subtitle, margin=margin, y=y, color=text_secondary)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
