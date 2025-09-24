from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Dict, Tuple

import swisseph as swe


EPHE_DIR_ENV = "SWISS_EPHE_DIR"


@contextmanager
def EphemerisContext():
    ephe_path = os.environ.get(EPHE_DIR_ENV, os.path.join(os.path.dirname(__file__), "..", "..", "ephemeris"))
    swe.set_ephe_path(os.path.abspath(ephe_path))
    try:
        yield swe
    finally:
        # Swiss Ephemeris is mostly stateless in Python binding; ensure file handles closed
        pass


PLANETS = [
    swe.SUN,
    swe.MOON,
    swe.MERCURY,
    swe.VENUS,
    swe.MARS,
    swe.JUPITER,
    swe.SATURN,
]


def zodiac_sign(lon: float) -> str:
    signs = [
        "Aries",
        "Taurus",
        "Gemini",
        "Cancer",
        "Leo",
        "Virgo",
        "Libra",
        "Scorpio",
        "Sagittarius",
        "Capricorn",
        "Aquarius",
        "Pisces",
    ]
    idx = int(lon // 30) % 12
    return signs[idx]


def normalize_deg(x: float) -> float:
    x %= 360.0
    if x < 0:
        x += 360.0
    return x

