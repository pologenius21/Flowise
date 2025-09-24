from __future__ import annotations

from datetime import datetime, timedelta
from typing import Generator, Tuple

import pytz


def resolve_location_timezone(
    location: str | None,
    latitude: float | None,
    longitude: float | None,
    timezone: str | None,
) -> tuple[str, float, float]:
    # Minimal resolver: prefer explicit lat/long+tz; otherwise attempt to infer tz from lat/long
    # If nothing provided, default to New York City
    if latitude is None or longitude is None:
        # TODO: add city name geocoding in future; for now default
        latitude = 40.7128
        longitude = -74.0060
    if timezone:
        tz_name = timezone
    else:
        # Try to resolve with timezonefinder if available; otherwise fallback
        tz_name = None
        try:
            from timezonefinder import TimezoneFinder  # type: ignore

            tf = TimezoneFinder()
            tz_name = tf.timezone_at(lng=longitude, lat=latitude)
        except Exception:
            tz_name = None
        if not tz_name:
            tz_name = "America/New_York"
    return tz_name, float(latitude), float(longitude)


def iter_minutes(start_dt: datetime, end_dt: datetime) -> Generator[datetime, None, None]:
    cur = start_dt
    step = timedelta(minutes=1)
    while cur < end_dt:
        yield cur
        cur += step

