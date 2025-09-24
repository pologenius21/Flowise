from __future__ import annotations

import base64
from typing import Tuple

from jinja2 import Environment, PackageLoader, select_autoescape


def render_report(req) -> Tuple[str, str | None]:
    # Minimal HTML; PDF optional
    env = Environment(loader=PackageLoader("app", "templates"), autoescape=select_autoescape())
    try:
        template = env.get_template("report.html")
    except Exception:
        html = f"<html><body><h1>Election Report</h1><pre>{req.summary.model_dump_json(indent=2)}</pre></body></html>"
        return html, None
    html = template.render(summary=req.summary)
    return html, None

