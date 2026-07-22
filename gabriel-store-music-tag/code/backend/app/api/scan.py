"""Scan control endpoints."""
from fastapi import APIRouter, BackgroundTasks

from ..schemas import ScanStatus
from ..services import scanner

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.post("", response_model=ScanStatus)
def start_scan(background_tasks: BackgroundTasks):
    """Trigger an incremental scan of the music volume (runs in background)."""
    if not scanner.is_scanning():
        background_tasks.add_task(scanner.run_scan)
    return ScanStatus(**scanner.scan_status)


@router.get("/status", response_model=ScanStatus)
def get_status():
    return ScanStatus(**scanner.scan_status)
