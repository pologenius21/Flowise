Wealth Talisman Election API

Setup

1) Create venv and install deps:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2) Swiss Ephemeris files

- Place SE ephemeris files in `backend/ephemeris/` or set `SWISS_EPHE_DIR` to your path.
- The app uses `pyswisseph` and expects standard `.se1`/`.se2` files.

3) Run API

```bash
python uvicorn_run.py
```

- Health: `GET http://localhost:8000/health`
- Scan: `POST http://localhost:8000/scan`

Notes

- Default model: geocentric, tropical, classical seven planets.
- Default houses: Alcabitius; Whole-Sign toggle via request.
- Time/geo via timezonefinder and pytz; sunrise/sunset via astral (TBD).

