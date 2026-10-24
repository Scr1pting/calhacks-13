"""HTTP API for the pickup-lateness prior: `uvicorn api:app --reload`."""

import os
import re

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import prior

GRID = np.arange(-prior.C, 91.0)  # minutes from window start, 1-min steps
QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9, 0.95)

app = FastAPI(title="Paramobility prediction")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class Params(BaseModel):
    """log(L + shift) ~ Normal(mu, sigma^2), L in minutes from window start."""

    mu: float
    sigma: float
    shift: float


class Prior(BaseModel):
    time: str
    params: Params
    p_late: float  # P(pickup after the 30-min window)
    quantiles: dict[str, float]  # "0.5" -> median minutes from window start
    minutes: list[float]
    pdf: list[float]
    cdf: list[float]


def parse_time(time: str) -> int:
    match = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", time)
    if not match:
        raise HTTPException(422, f"invalid time {time!r}: expected HH:MM, 24-hour")
    return int(match[1]) * 60 + int(match[2])


@app.get("/prior")
def get_prior(
    time: str = Query(..., description="Window start, HH:MM (24-hour), 05:00-23:59"),
) -> Prior:
    minutes = parse_time(time)
    try:
        mu = float(prior.mu0(minutes))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    d = prior.prior(minutes)
    return Prior(
        time=f"{minutes // 60:02d}:{minutes % 60:02d}",
        params=Params(mu=mu, sigma=prior.S, shift=prior.C),
        p_late=float(prior.p_late(minutes)),
        quantiles={str(q): float(d.ppf(q)) for q in QUANTILES},
        minutes=GRID.tolist(),
        pdf=d.pdf(GRID).tolist(),
        cdf=d.cdf(GRID).tolist(),
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True}
