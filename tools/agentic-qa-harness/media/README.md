# Project Media Gallery

Devpost accepts JPG, PNG or GIF files up to 5 MB each. These PNGs are generated at **1800 × 1200 px**, a **3:2 ratio**.

Recommended upload order:

1. `01-title-agentic-qa-harness.png` — project title and value proposition.
2. `02-blackbox-architecture.png` — blackbox QA architecture flow.
3. `03-smoke-result.png` — runnable smoke-test proof.
4. `04-governance-checks.png` — safe failure and policy checks.
5. `05-try-it-out.png` — commands and artifact structure.

Optional review/contact sheet:

- `gallery-contact-sheet.png` — all five images in one overview for quick visual inspection; not intended as a primary Devpost upload.

Regenerate from the repository root:

```bash
uv run --with pillow python tools/agentic-qa-harness/media/generate-gallery.py
```
