from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field, field_validator


class HouseSystem(str, Enum):
    alcabitius = "alcabitius"
    whole_sign = "whole_sign"


class Preferences(BaseModel):
    prefer_thursday: bool = False
    require_jupiter_hour: bool = False
    require_moon_early_aries: bool = False
    minimum_score: int = 0


class OrbsConfig(BaseModel):
    trine: float = 6.0
    sextile: float = 6.0
    square: float = 6.0
    opposition: float = 6.0
    combust: float = 8.5  # degrees
    under_beams: float = 17.0
    angle_band: float = 5.0


class ScanRequest(BaseModel):
    mode: str = Field(default="horary")
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    timezone: str | None = None
    start_date: str
    end_date: str | None = None
    house_system: HouseSystem = HouseSystem.alcabitius
    orbs: OrbsConfig = OrbsConfig()
    preferences: Preferences = Preferences()

    @field_validator("mode")
    @classmethod
    def _mode_fixed(cls, v: str) -> str:  # noqa: D401
        # Mode is fixed to horary for now
        if v.lower() != "horary":
            return "horary"
        return v


class HealthResponse(BaseModel):
    status: str


class GateResult(BaseModel):
    name: str
    passed: bool
    reason: Optional[str] = None


class PicatrixChecklist(BaseModel):
    items: List[str]


class ElectionSummary(BaseModel):
    timestamp_iso: str
    timezone: str
    house_system: HouseSystem
    asc_sign: str
    asc_degree: float
    lords: Dict[str, Dict[str, Any]]
    l2_l1_aspect: Optional[str] = None
    l2_l1_orb: Optional[float] = None
    reception: Optional[str] = None
    moon: Dict[str, Any]
    pof: Dict[str, Any]
    malefics: Dict[str, Any]
    score: int
    picatrix: Dict[str, Any]
    gates: List[GateResult]


class ScanResponse(BaseModel):
    results: List[ElectionSummary] = []
    diagnostics: Dict[str, Any] = {}


class ReportRequest(BaseModel):
    timestamp_iso: str
    timezone: str
    summary: ElectionSummary


class ReportResponse(BaseModel):
    html: str
    pdf_base64: Optional[str] = None


# Utility fixed domicile rulers
DOMICILE_RULERS: Dict[str, str] = {
    "Aries": "Mars",
    "Taurus": "Venus",
    "Gemini": "Mercury",
    "Cancer": "Moon",
    "Leo": "Sun",
    "Virgo": "Mercury",
    "Libra": "Venus",
    "Scorpio": "Mars",
    "Sagittarius": "Jupiter",
    "Capricorn": "Saturn",
    "Aquarius": "Saturn",
    "Pisces": "Jupiter",
}

