# Delay-model notebooks

These fit the constants baked into `app/prediction/`:

- `prior_ny_smooth.ipynb` -> `prior.py` (`_MU0_HOURLY`, `S`); `prior_simple` and `prior_ny` are
  earlier versions.
- `ride_time_drive.ipynb` -> `ride.py` (`KAPPA`, `S_RIDE`, `OVERHEAD_MIN`, via `ride_params.json`).

Install the extras into the backend's environment with `pip install -e ".[notebooks]"` and open
the notebooks with that kernel. `ride_time_drive.ipynb` reads `GOOGLE_MAPS_KEY` (or
`ORS_API_KEY`) from `notebooks/.env` and caches drive times in `drive_cache.json`, both
git-ignored.
