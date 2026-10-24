"""FastAPI entry point: `uvicorn app.main:app`."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.monitor import monitor_loop
from app.api import riders, trips, voice
from app.core.config import get_settings
from app.core.jobs import spawn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = spawn(monitor_loop(), name="monitor")
    yield
    loop.cancel()


app = FastAPI(title="Paramobility", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(trips.router)
app.include_router(riders.router)
app.include_router(voice.router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}
