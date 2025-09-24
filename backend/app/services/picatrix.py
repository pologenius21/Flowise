from __future__ import annotations

from datetime import datetime
from typing import Dict, Any

import pytz

from ..models import Preferences


def evaluate_picatrix(snapshot: Dict[str, Any], tz: pytz.BaseTzInfo, prefs: Preferences) -> Dict[str, Any]:
    # Placeholder: compute flags only; score zero until full engine implemented
    flags: Dict[str, bool] = {
        "thursday": False,
        "jupiter_hour": False,
        "sun_in_sag_pis": False,
        "moon_early_aries": False,
        "jupiter_angular": False,
        "jupiter_dignities": False,
    }
    return {"flags": flags, "score": 0, "checklist": _checklist()}


def _checklist() -> Dict[str, Any]:
    return {
        "metal": "Tin",
        "stone": "Chalcedony",
        "color": "Green (silk)",
        "suffumigations": ["Mastic", "Lignum aloes"],
        "names": ["Jupiter", "Zeus"],
    }

