from __future__ import annotations

from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional

import pytz

from ..models import GateResult, OrbsConfig, HouseSystem, DOMICILE_RULERS
from .swe_utils import zodiac_sign, normalize_deg, EphemerisContext
from .astro import (
    julday_utc,
    houses,
    planet_positions,
    find_house_for_longitude,
    classify_house,
    distance,
    is_combust,
    is_under_beams,
    part_of_fortune,
    is_day_chart,
    aspect_type,
    is_opposite_domicile,
    reception_sign,
    reception_exaltation,
)


def evaluate_de_imaginibus(
    eph,
    dt: datetime,
    tz: pytz.BaseTzInfo,
    latitude: float,
    longitude: float,
    house_system: HouseSystem,
    orbs: OrbsConfig,
) -> tuple[List[GateResult], Dict[str, Any]]:
    jd = julday_utc(eph, dt, tz)
    cusps, ascmc = houses(eph, jd, latitude, longitude, house_system.value)
    asc_lon = ascmc[0]
    asc_sign = zodiac_sign(asc_lon)
    asc_deg = normalize_deg(asc_lon) % 30.0

    positions = planet_positions(eph, jd)
    # Determine houses for planets
    planet_houses: Dict[str, int] = {name: find_house_for_longitude(p["lon"], cusps) for name, p in positions.items()}

    # Lords by house cusps
    def lord_of_house(n: int) -> str:
        sign = zodiac_sign(cusps[n - 1])
        return DOMICILE_RULERS[sign]

    l1 = DOMICILE_RULERS[asc_sign]
    l2 = lord_of_house(2)
    l10 = lord_of_house(10)
    l11 = lord_of_house(11)
    l8 = lord_of_house(8)

    # Moon info
    moon = positions["Moon"]
    moon_house = planet_houses["Moon"]

    # Day/night
    sun_house = planet_houses["Sun"]
    day_flag = is_day_chart(sun_house)

    # Part of Fortune
    pof_lon = part_of_fortune(asc_lon, positions["Sun"]["lon"], positions["Moon"]["lon"], day_flag)
    pof_sign = zodiac_sign(pof_lon)
    pof_house = find_house_for_longitude(pof_lon, cusps)
    # Distance to nearest angle (1/4/7/10 cusps)
    angles = [cusps[0], cusps[3], cusps[6], cusps[9]]
    pof_angle_distance = min(distance(pof_lon, a) for a in angles)

    # Combust/under-beams flags
    combust_deg = orbs.combust
    under_beams_deg = orbs.under_beams
    def flags_for(name: str) -> Dict[str, Any]:
        p = positions[name]
        return {
            "sign": p["sign"],
            "house": planet_houses[name],
            "speed": p["speed"],
            "retro": p["retro"],
            "combust": is_combust(p["lon"], positions["Sun"]["lon"], combust_deg),
            "under_beams": is_under_beams(p["lon"], positions["Sun"]["lon"], under_beams_deg),
            "angularity": classify_house(planet_houses[name]),
        }

    lords = {
        "L1": flags_for(l1),
        "L2": flags_for(l2),
        "L10": flags_for(l10),
        "L11": flags_for(l11),
        "L8": flags_for(l8),
    }

    # L2–L1 aspect and reception
    delta = distance(positions[l2]["lon"], positions[l1]["lon"])
    orb_map = {
        "trine": orbs.trine,
        "sextile": orbs.sextile,
        "square": orbs.square,
        "opposition": orbs.opposition,
    }
    asp = aspect_type(delta, orb_map)
    reception = None
    if asp and asp[0] in {"trine", "sextile"}:
        sign_rec = reception_sign(l2, positions[l2]["sign"], l1, DOMICILE_RULERS) or reception_sign(l1, positions[l1]["sign"], l2, DOMICILE_RULERS)
        exalt_rec = reception_exaltation(l2, positions[l2]["sign"]) or reception_exaltation(l1, positions[l1]["sign"])  # type: ignore[arg-type]
        if sign_rec and reception_exaltation(l1, positions[l1]["sign"]) and reception_exaltation(l2, positions[l2]["sign"]):
            reception = "mutual-exaltation"
        elif sign_rec and (reception_sign(l1, positions[l1]["sign"], l2, DOMICILE_RULERS) and reception_sign(l2, positions[l2]["sign"], l1, DOMICILE_RULERS)):
            reception = "mutual-sign"
        elif sign_rec:
            reception = "sign"
        elif exalt_rec:
            reception = "exaltation"

    # Malefics vs angles
    angle_band = orbs.angle_band
    def near_angle(lon: float) -> bool:
        return any(distance(lon, a) <= angle_band for a in angles)

    mars_near_asc = near_angle(positions["Mars"]["lon"])
    saturn_near_asc = near_angle(positions["Saturn"]["lon"])

    malefics = {
        "mars": {"house": planet_houses["Mars"], "angular": classify_house(planet_houses["Mars"]) == "angular", "near_angle": mars_near_asc},
        "saturn": {"house": planet_houses["Saturn"], "angular": classify_house(planet_houses["Saturn"]) == "angular", "near_angle": saturn_near_asc},
    }

    snapshot: Dict[str, Any] = {
        "asc": {"sign": asc_sign, "degree": asc_deg},
        "lords": lords,
        "l2_l1_aspect": asp[0] if asp else None,
        "l2_l1_orb": asp[1] if asp else None,
        "reception": reception,
        "moon": {"sign": moon["sign"], "house": moon_house},
        "pof": {"sign": pof_sign, "house": pof_house, "angle_distance": pof_angle_distance},
        "malefics": malefics,
        "score_base": 0,
    }

    gates: List[GateResult] = []

    # Hard gates
    # 1) Ascendant + L1 fortunate
    l1_info = lords["L1"]
    l1_ok = True
    reason_l1: Optional[str] = None
    if l1_info["retro"]:
        l1_ok, reason_l1 = False, "L1 retrograde"
    elif l1_info["combust"]:
        l1_ok, reason_l1 = False, "L1 combust"
    elif l1_info["angularity"] == "cadent":
        l1_ok, reason_l1 = False, "L1 cadent"
    elif is_opposite_domicile(l1, positions[l1]["sign"], DOMICILE_RULERS):
        l1_ok, reason_l1 = False, "L1 in opposite of domicile"
    gates.append(GateResult(name="Ascendant + L1 fortunate", passed=l1_ok, reason=reason_l1))

    # 2) Moon fortunate
    moon_ok = True
    reason_moon: Optional[str] = None
    if is_combust(positions["Moon"]["lon"], positions["Sun"]["lon"], combust_deg):
        moon_ok, reason_moon = False, "Moon combust"
    else:
        # Avoid applying square/opposition to Mars or Saturn within orb
        for mal in ("Mars", "Saturn"):
            d = distance(positions["Moon"]["lon"], positions[mal]["lon"]) 
            aspect = aspect_type(d, {"square": orbs.square, "opposition": orbs.opposition})
            if aspect:
                moon_ok, reason_moon = False, f"Moon applying {aspect[0]} to {mal}"
                break
    gates.append(GateResult(name="Moon fortunate", passed=moon_ok, reason=reason_moon))

    # 3) Wealth link present: L2 sextile/trine L1 with reception
    wealth_ok = False
    wealth_reason: Optional[str] = None
    if asp and asp[0] in {"trine", "sextile"} and reception:
        wealth_ok = True
    else:
        wealth_reason = "No L29 L1 favorable aspect with reception"
    gates.append(GateResult(name="Wealth link present (L2 △/✶ L1 + reception)", passed=wealth_ok, reason=wealth_reason))

    # 4) Support houses strengthened: 10th and 11th fortunate
    def fortunate(lord: Dict[str, Any]) -> bool:
        return lord["angularity"] in {"angular", "succedent"} and not lord["combust"] and not lord["retro"]
    h10_ok = fortunate(lords["L10"]) 
    h11_ok = fortunate(lords["L11"]) 
    gates.append(GateResult(name="10th fortunate", passed=h10_ok, reason=None if h10_ok else "L10 lord weak"))
    gates.append(GateResult(name="11th fortunate", passed=h11_ok, reason=None if h11_ok else "L11 lord weak"))

    # 5) Part of Fortune
    pof_ok = False
    pof_reason: Optional[str] = None
    if pof_house in {1, 10}:
        pof_ok = True
    else:
        if pof_house in {12, 11, 2} and lords.get("L10")["angularity"] == "angular":
            pof_ok = True
        else:
            pof_reason = "PoF not in 1/10 and PoF lord not strong angular"
    gates.append(GateResult(name="Part of Fortune condition", passed=pof_ok, reason=pof_reason))

    # 6) Infortunes management
    mal_ok = True
    mal_reason: Optional[str] = None
    if planet_houses["Mars"] in ANGULAR_HOUSES or planet_houses["Saturn"] in ANGULAR_HOUSES:
        mal_ok, mal_reason = False, "Malefic angular"
    if near_angle(asc_lon := ascmc[0]) and (distance(positions["Mars"]["lon"], asc_lon) <= angle_band or distance(positions["Saturn"]["lon"], asc_lon) <= angle_band):
        mal_ok, mal_reason = False, "Malefic on Asc"
    gates.append(GateResult(name="Infortunes managed", passed=mal_ok, reason=mal_reason))

    # Base DI scoring (soft preferences)
    score = 0
    score += 4 if l1_info["angularity"] == "angular" else (2 if l1_info["angularity"] == "succedent" else 0)
    score += 3 if classify_house(moon_house) == "angular" else (1 if classify_house(moon_house) == "succedent" else 0)
    if asp and asp[0] in {"trine", "sextile"}:
        score += max(0, int(10 - (asp[1] or 0)))
    if reception == "mutual-sign":
        score += 6
    elif reception == "sign":
        score += 4
    elif reception == "mutual-exaltation":
        score += 3
    elif reception == "exaltation":
        score += 2
    if pof_house in {1, 10}:
        score += 3
    if pof_angle_distance <= 3.0:
        score += 2
    if lords["L10"]["angularity"] == "angular":
        score += 3
    if lords["L11"]["angularity"] == "angular":
        score += 2
    if lords["L8"]["angularity"] == "angular":
        score += 1
    if classify_house(planet_houses["Mars"]) == "cadent":
        score += 1
    if classify_house(planet_houses["Saturn"]) == "cadent":
        score += 1
    snapshot["score_base"] = score

    return gates, snapshot

