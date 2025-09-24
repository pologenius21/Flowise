from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Tuple, Dict, Any

import pytz

from ..models import ScanRequest, ScanResponse, ElectionSummary, GateResult, HouseSystem
from .swe_utils import EphemerisContext
from .timegeo import resolve_location_timezone, iter_minutes
from .di_engine import evaluate_de_imaginibus
from .picatrix import evaluate_picatrix


def scan_range(req: ScanRequest) -> ScanResponse:
    tz_name, latitude, longitude = resolve_location_timezone(
        req.location, req.latitude, req.longitude, req.timezone
    )

    tz = pytz.timezone(tz_name)
    start_dt = tz.localize(datetime.fromisoformat(req.start_date))
    end_dt = start_dt if not req.end_date else tz.localize(datetime.fromisoformat(req.end_date))

    results: List[ElectionSummary] = []
    diagnostics: Dict[str, Any] = {"logs": []}

    with EphemerisContext() as eph:
        prioritized_days: List[datetime] = _prioritize_days(start_dt, end_dt, req.preferences.prefer_thursday)
        for day in prioritized_days:
            for t in iter_minutes(day, day + timedelta(days=1)):
                gates, snapshot = evaluate_de_imaginibus(
                    eph=eph,
                    dt=t,
                    tz=tz,
                    latitude=latitude,
                    longitude=longitude,
                    house_system=req.house_system,
                    orbs=req.orbs,
                )
                if all(g.passed for g in gates):
                    pic = evaluate_picatrix(snapshot, tz, req.preferences)
                    score = snapshot["score_base"] + pic["score"]
                    results.append(_to_summary(t, tz_name, req.house_system, snapshot, gates, pic, score))
            if results:
                break

    results.sort(key=lambda r: r.score, reverse=True)

    return ScanResponse(results=results, diagnostics=diagnostics)


def _prioritize_days(start_dt: datetime, end_dt: datetime, thursdays_first: bool) -> List[datetime]:
    days: List[datetime] = []
    cur = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    while cur <= end_dt:
        days.append(cur)
        cur += timedelta(days=1)
    if thursdays_first:
        thurs = [d for d in days if d.weekday() == 3]
        others = [d for d in days if d.weekday() != 3]
        return thurs + others
    return days


def _to_summary(
    t: datetime,
    tz_name: str,
    house_system: HouseSystem,
    snapshot: Dict[str, Any],
    gates: List[GateResult],
    pic: Dict[str, Any],
    score: int,
) -> ElectionSummary:
    return ElectionSummary(
        timestamp_iso=t.isoformat(),
        timezone=tz_name,
        house_system=house_system,
        asc_sign=snapshot["asc"]["sign"],
        asc_degree=snapshot["asc"]["degree"],
        lords=snapshot["lords"],
        l2_l1_aspect=snapshot.get("l2_l1_aspect"),
        l2_l1_orb=snapshot.get("l2_l1_orb"),
        reception=snapshot.get("reception"),
        moon=snapshot["moon"],
        pof=snapshot["pof"],
        malefics=snapshot["malefics"],
        score=score,
        picatrix=pic,
        gates=gates,
    )

