from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple, Optional

import math
import pytz

from .swe_utils import normalize_deg, zodiac_sign


PLANET_NAMES = {
    0: "Sun",
    1: "Moon",
    2: "Mercury",
    3: "Venus",
    4: "Mars",
    5: "Jupiter",
    6: "Saturn",
}


EXALTATIONS: Dict[str, str] = {
    "Sun": "Aries",
    "Moon": "Taurus",
    "Mercury": "Virgo",
    "Venus": "Pisces",
    "Mars": "Capricorn",
    "Jupiter": "Cancer",
    "Saturn": "Libra",
}


ANGULAR_HOUSES = {1, 4, 7, 10}
SUCCEDENT_HOUSES = {2, 5, 8, 11}
CADENT_HOUSES = {3, 6, 9, 12}


def julday_utc(eph, dt_local, tz) -> float:
    dt_utc = dt_local.astimezone(pytz.UTC)
    return eph.julday(dt_utc.year, dt_utc.month, dt_utc.day, dt_utc.hour + dt_utc.minute / 60 + dt_utc.second / 3600.0)


def houses(eph, jd_ut: float, latitude: float, longitude: float, house_system: str) -> Tuple[List[float], List[float]]:
    # Swiss Ephemeris hsys codes: 'A' = Alcabitius, 'W' = Whole Sign
    hsys_code = 'A' if house_system == 'alcabitius' else 'W'
    cusps, ascmc = eph.houses_ex(jd_ut, 0, latitude, longitude, hsys_code)
    return list(cusps), list(ascmc)


def planet_positions(eph, jd_ut: float) -> Dict[str, Dict[str, float]]:
    flags = eph.FLG_SWIEPH | eph.FLG_SPEED
    planets_idx = [eph.SUN, eph.MOON, eph.MERCURY, eph.VENUS, eph.MARS, eph.JUPITER, eph.SATURN]
    pos: Dict[str, Dict[str, float]] = {}
    for idx in planets_idx:
        lon, lat, dist, lon_speed = eph.calc_ut(jd_ut, idx, flags)[0][0], eph.calc_ut(jd_ut, idx, flags)[0][1], eph.calc_ut(jd_ut, idx, flags)[0][2], eph.calc_ut(jd_ut, idx, flags)[0][3]
        name = PLANET_NAMES[idx]
        pos[name] = {
            "lon": normalize_deg(lon),
            "lat": lat,
            "speed": lon_speed,
            "retro": lon_speed < 0,
            "sign": zodiac_sign(lon),
            "degree": normalize_deg(lon) % 30.0,
        }
    return pos


def find_house_for_longitude(lon: float, cusps: List[float]) -> int:
    # cusps is 1..12 stored in 0..11
    adj = [normalize_deg(c) for c in cusps]
    lon = normalize_deg(lon)
    # Walk through cusps to find the segment
    for i in range(12):
        start = adj[i]
        end = adj[(i + 1) % 12]
        if start <= end:
            if start <= lon < end:
                return i + 1
        else:
            # wrap
            if lon >= start or lon < end:
                return i + 1
    return 12


def classify_house(n: int) -> str:
    if n in ANGULAR_HOUSES:
        return "angular"
    if n in SUCCEDENT_HOUSES:
        return "succedent"
    return "cadent"


def distance(a: float, b: float) -> float:
    d = abs(normalize_deg(a - b))
    return d if d <= 180 else 360 - d


def is_combust(planet_lon: float, sun_lon: float, combust_deg: float) -> bool:
    return distance(planet_lon, sun_lon) <= combust_deg


def is_under_beams(planet_lon: float, sun_lon: float, under_beams_deg: float) -> bool:
    return distance(planet_lon, sun_lon) <= under_beams_deg


def part_of_fortune(asc_lon: float, sun_lon: float, moon_lon: float, is_day: bool) -> float:
    if is_day:
        pof = asc_lon + moon_lon - sun_lon
    else:
        pof = asc_lon + sun_lon - moon_lon
    return normalize_deg(pof)


def is_day_chart(sun_house: int) -> bool:
    return sun_house >= 7


def aspect_type(delta: float, orbs: Dict[str, float]) -> Optional[Tuple[str, float]]:
    # Return (aspect_name, orb_distance) if within orb of sextile/trine/square/opposition
    targets = {
        "sextile": 60.0,
        "square": 90.0,
        "trine": 120.0,
        "opposition": 180.0,
    }
    for name, exact in targets.items():
        orb_allow = orbs.get(name, 6.0)
        diff = abs(delta - exact)
        if diff <= orb_allow:
            return name, diff
    return None


def is_opposite_domicile(planet: str, planet_sign: str, domicile_rulers: Dict[str, str]) -> bool:
    # Check if planet is in the sign exactly opposite its own domicile(s)
    # Build domiciles list for the planet
    domiciles = [sign for sign, ruler in domicile_rulers.items() if ruler == planet]
    opposites = {
        "Aries": "Libra",
        "Taurus": "Scorpio",
        "Gemini": "Sagittarius",
        "Cancer": "Capricorn",
        "Leo": "Aquarius",
        "Virgo": "Pisces",
        "Libra": "Aries",
        "Scorpio": "Taurus",
        "Sagittarius": "Gemini",
        "Capricorn": "Cancer",
        "Aquarius": "Leo",
        "Pisces": "Virgo",
    }
    return any(opposites[d] == planet_sign for d in domiciles)


def reception_sign(a_name: str, a_sign: str, b_name: str, domicile_rulers: Dict[str, str]) -> bool:
    # a is received by b if a is in b's domicile
    return domicile_rulers.get(a_sign) == b_name


def reception_exaltation(a_name: str, a_sign: str) -> bool:
    return EXALTATIONS.get(a_name) == a_sign

