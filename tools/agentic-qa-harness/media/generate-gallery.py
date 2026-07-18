#!/usr/bin/env python3
"""Generate 3:2 Devpost gallery images for the Agentic QA Harness.

Run from the repository root:
    uv run --with pillow python tools/agentic-qa-harness/media/generate-gallery.py
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1800
HEIGHT = 1200
OUT_DIR = Path(__file__).resolve().parent
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
SANS = FONT_DIR / 'DejaVuSans.ttf'
SANS_BOLD = FONT_DIR / 'DejaVuSans-Bold.ttf'
MONO = FONT_DIR / 'DejaVuSansMono.ttf'
MONO_BOLD = FONT_DIR / 'DejaVuSansMono-Bold.ttf'

BG = '#07111f'
CARD = '#0f1b2d'
CARD2 = '#102236'
TEXT = '#e5f2ff'
MUTED = '#92a4b8'
GRID = '#1f3147'
EMERALD = '#34d399'
CYAN = '#22d3ee'
VIOLET = '#a78bfa'
AMBER = '#fbbf24'
ROSE = '#fb7185'
SLATE = '#64748b'


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size)


def canvas(title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new('RGB', (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    for x in range(0, WIDTH, 60):
        d.line((x, 0, x, HEIGHT), fill=GRID, width=1)
    for y in range(0, HEIGHT, 60):
        d.line((0, y, WIDTH, y), fill=GRID, width=1)
    # soft horizon blocks
    d.rounded_rectangle((70, 70, WIDTH - 70, HEIGHT - 70), radius=36, outline='#1c3552', width=2, fill='#081526')
    d.ellipse((90, 102, 118, 130), fill=EMERALD)
    d.text((135, 90), title, font=font(SANS_BOLD, 58), fill=TEXT)
    d.text((137, 165), subtitle, font=font(SANS, 27), fill=MUTED)
    return img, d


def text_size(d: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> tuple[int, int]:
    box = d.textbbox((0, 0), text, font=fnt)
    return int(box[2] - box[0]), int(box[3] - box[1])


def draw_wrapped(
    d: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    max_width: int,
    fnt: ImageFont.FreeTypeFont,
    fill: str = TEXT,
    line_gap: int = 8,
) -> int:
    words = text.split()
    lines: list[str] = []
    current = ''
    for word in words:
        candidate = word if not current else f'{current} {word}'
        if text_size(d, candidate, fnt)[0] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    x, y = xy
    for line in lines:
        d.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_gap
    return int(y)


def card(
    d: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    title: str,
    body: Sequence[str],
    accent: str,
    title_size: int = 30,
) -> None:
    x1, y1, x2, y2 = box
    d.rounded_rectangle(box, radius=22, fill=CARD, outline=accent, width=3)
    d.rectangle((x1, y1, x1 + 10, y2), fill=accent)
    d.text((x1 + 34, y1 + 28), title, font=font(SANS_BOLD, title_size), fill=TEXT)
    y = y1 + 90
    for line in body:
        d.text((x1 + 38, y), '•', font=font(SANS_BOLD, 26), fill=accent)
        y = draw_wrapped(d, line, (x1 + 72, y), x2 - x1 - 110, font(SANS, 24), MUTED, 7)
        y += 14


def arrow(d: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color: str, width: int = 5) -> None:
    d.line((*start, *end), fill=color, width=width)
    ex, ey = end
    sx, sy = start
    if abs(ex - sx) >= abs(ey - sy):
        direction = 1 if ex > sx else -1
        pts = [(ex, ey), (ex - direction * 28, ey - 16), (ex - direction * 28, ey + 16)]
    else:
        direction = 1 if ey > sy else -1
        pts = [(ex, ey), (ex - 16, ey - direction * 28), (ex + 16, ey - direction * 28)]
    d.polygon(pts, fill=color)


def pill(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], label: str, color: str, fnt_size: int = 24) -> None:
    d.rounded_rectangle(box, radius=999, fill='#0b1728', outline=color, width=3)
    tw, th = text_size(d, label, font(SANS_BOLD, fnt_size))
    d.text(((box[0] + box[2] - tw) // 2, (box[1] + box[3] - th) // 2 - 3), label, font=font(SANS_BOLD, fnt_size), fill=color)


def image_01() -> None:
    img, d = canvas('Agentic QA Harness', 'QA receipts for governed tool-using agents')
    d.text((145, 300), 'Test the path,', font=font(SANS_BOLD, 70), fill=TEXT)
    d.text((145, 385), 'not just the answer.', font=font(SANS_BOLD, 70), fill=TEXT)
    draw_wrapped(
        d,
        'A blackbox smoke harness that checks routing, context, validation, governance, response safety and receipt schema using synthetic agent scenarios.',
        (150, 495),
        940,
        font(SANS, 32),
        MUTED,
        12,
    )
    pill(d, (150, 700, 430, 770), '8/8 PASS', EMERALD, 30)
    pill(d, (460, 700, 775, 770), 'No credentials', CYAN, 30)
    pill(d, (805, 700, 1120, 770), 'No live writes', AMBER, 30)
    # receipt card
    d.rounded_rectangle((1190, 280, 1635, 860), radius=28, fill=CARD, outline=EMERALD, width=4)
    d.text((1240, 330), 'QA RECEIPT', font=font(MONO_BOLD, 34), fill=EMERALD)
    rows = [('routing', 'PASS'), ('validation', 'PASS'), ('context', 'PASS'), ('governance', 'PASS'), ('response', 'PASS'), ('schema', 'PASS')]
    y = 405
    for key, value in rows:
        d.text((1240, y), key, font=font(MONO, 26), fill=MUTED)
        d.text((1510, y), value, font=font(MONO_BOLD, 26), fill=EMERALD)
        y += 66
    d.text((150, 1010), 'OpenAI Hackathon • Developer Tools • Synthetic blackbox agent QA', font=font(SANS, 28), fill=SLATE)
    img.save(OUT_DIR / '01-title-agentic-qa-harness.png', optimize=True)


def image_02() -> None:
    img, d = canvas('Blackbox architecture', 'Scenario fixtures → governed checks → auditable reports')
    boxes = [
        ((135, 390, 430, 560), 'Synthetic\nScenarios', CYAN),
        ((565, 390, 860, 560), 'Smoke\nHarness', EMERALD),
        ((995, 390, 1290, 560), 'QA\nReceipt', VIOLET),
        ((1425, 390, 1655, 560), 'Devpost\nArtifact', AMBER),
    ]
    for (x1, y1, x2, y2), label, color in boxes:
        d.rounded_rectangle((x1, y1, x2, y2), radius=24, fill=CARD, outline=color, width=4)
        lines = label.split('\n')
        yy = y1 + 42
        for line in lines:
            tw, _ = text_size(d, line, font(SANS_BOLD, 34))
            d.text(((x1 + x2 - tw) // 2, yy), line, font=font(SANS_BOLD, 34), fill=TEXT)
            yy += 46
    arrow(d, (430, 475), (565, 475), EMERALD)
    arrow(d, (860, 475), (995, 475), VIOLET)
    arrow(d, (1290, 475), (1425, 475), AMBER)
    card(d, (150, 700, 625, 980), 'Fixture cases', ['multi-turn chat', 'tool request events', 'expected behavioral constraints'], CYAN, 28)
    card(d, (665, 700, 1140, 980), 'Behavior checks', ['right capability', 'safe missing input', 'context purge', 'blocked unsafe tools'], EMERALD, 28)
    card(d, (1180, 700, 1655, 980), 'Outputs', ['Markdown report', 'JSON receipt', 'CI-friendly node:test'], VIOLET, 28)
    img.save(OUT_DIR / '02-blackbox-architecture.png', optimize=True)


def image_03() -> None:
    img, d = canvas('Smoke result', 'A small, reproducible proof for judges and maintainers')
    d.rounded_rectangle((135, 275, 1665, 940), radius=24, fill='#050b14', outline='#203854', width=3)
    d.rectangle((135, 275, 1665, 345), fill='#0f1b2d')
    d.ellipse((165, 300, 185, 320), fill=ROSE)
    d.ellipse((198, 300, 218, 320), fill=AMBER)
    d.ellipse((231, 300, 251, 320), fill=EMERALD)
    d.text((280, 294), 'node tools/agentic-qa-harness/smoke.js', font=font(MONO_BOLD, 26), fill=TEXT)
    lines = [
        'PASS routing.solarLocation',
        'PASS validation.missingLocation',
        'PASS context.followupUsesLocation',
        'PASS context.purgeOnTopicChange',
        'PASS governance.unknownToolBlocked',
        'PASS governance.forbiddenWriteBlocked',
        'PASS response.noInternalMarkers',
        'PASS receipt.schema',
        '',
        'Verdict: PASS (8/8 passed)',
        'Report written: tools/agentic-qa-harness/reports/agentic-qa-smoke.md',
    ]
    y = 390
    for line in lines:
        color = EMERALD if line.startswith('PASS') or line.startswith('Verdict') else MUTED
        d.text((185, y), line, font=font(MONO, 30), fill=color)
        y += 48
    pill(d, (1300, 995, 1645, 1065), 'CI-friendly proof', CYAN, 28)
    img.save(OUT_DIR / '03-smoke-result.png', optimize=True)


def image_04() -> None:
    img, d = canvas('Governance checks', 'Safe behavior when tools are missing, unsafe or underspecified')
    card(d, (135, 280, 560, 540), 'Unknown tool', ['system.shell.exec is blocked', 'agent explains allowed surface', 'no raw internal error leaks'], ROSE, 30)
    card(d, (690, 280, 1115, 540), 'Write action', ['asset deletion is consequential', 'requires scoped approval', 'safe refusal by default'], AMBER, 30)
    card(d, (1240, 280, 1665, 540), 'Missing input', ['location is required', 'agent asks instead of guessing', 'no premature tool call'], CYAN, 30)
    d.text((210, 715), 'Policy result:', font=font(SANS_BOLD, 42), fill=TEXT)
    pill(d, (535, 700, 895, 775), 'FAIL CLOSED', ROSE, 36)
    d.text((210, 840), 'Developer benefit:', font=font(SANS_BOLD, 42), fill=TEXT)
    draw_wrapped(d, 'Failures become reviewable QA findings with evidence, suspected cause and a targeted fix path.', (210, 905), 1320, font(SANS, 34), MUTED, 12)
    img.save(OUT_DIR / '04-governance-checks.png', optimize=True)


def image_05() -> None:
    img, d = canvas('Try it out', 'One folder, one command, two report formats')
    d.rounded_rectangle((135, 290, 1665, 610), radius=24, fill='#050b14', outline=CYAN, width=3)
    d.text((185, 345), '$ node tools/agentic-qa-harness/smoke.js', font=font(MONO_BOLD, 38), fill=CYAN)
    d.text((185, 430), '$ node --test tests/agentic-qa-harness-smoke.test.js', font=font(MONO_BOLD, 38), fill=EMERALD)
    card(d, (150, 710, 625, 965), 'Input', ['fixtures/scenarios.json', 'synthetic, safe, no credentials'], CYAN, 30)
    card(d, (665, 710, 1140, 965), 'Runner', ['smoke.js', 'CommonJS, dependency-light'], EMERALD, 30)
    card(d, (1180, 710, 1655, 965), 'Output', ['agentic-qa-smoke.md', 'agentic-qa-smoke.json'], VIOLET, 30)
    d.text((150, 1035), 'Public path: tools/agentic-qa-harness', font=font(SANS_BOLD, 34), fill=TEXT)
    img.save(OUT_DIR / '05-try-it-out.png', optimize=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for generator in [image_01, image_02, image_03, image_04, image_05]:
        generator()
    for path in sorted(OUT_DIR.glob('*.png')):
        size_kb = path.stat().st_size / 1024
        print(f'{path.name}: {WIDTH}x{HEIGHT}, {size_kb:.1f} KB')


if __name__ == '__main__':
    main()
