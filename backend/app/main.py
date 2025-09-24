from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .models import HealthResponse, ScanRequest, ScanResponse, ReportRequest, ReportResponse
from .services.scan_engine import scan_range
from .services.reporter import render_report


app = FastAPI(title="Wealth Talisman Election API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/scan", response_model=ScanResponse)
def scan(req: ScanRequest) -> ScanResponse:
    try:
        return scan_range(req)
    except Exception as exc:  # noqa: BLE001 - bubble sanitized
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/report", response_model=ReportResponse)
def report(req: ReportRequest) -> ReportResponse:
    try:
        html, pdf_bytes = render_report(req)
        return ReportResponse(html=html, pdf_base64=pdf_bytes)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def get_app() -> FastAPI:
    return app

