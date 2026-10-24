# Delay-model research notebooks

The notebooks here fit the constants that are baked into the backend's delay model,
`paramobility/backend/app/prediction/` (served by the backend API):

- `prior_ny_smooth.ipynb` -> `prior.py` (`_MU0_HOURLY`, `S`)
- `ride_time_drive.ipynb` -> `ride.py` (`KAPPA`, `S_RIDE`, `OVERHEAD_MIN`, via `ride_params.json`)

Run `uv sync` here and open them with the `.venv` kernel (e.g. in VS Code). `ride_time_drive.ipynb` reads
`GOOGLE_MAPS_KEY` (or `ORS_API_KEY`) from `notebooks/.env`.
