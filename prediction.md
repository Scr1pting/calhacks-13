# Prediction

```
arrival = window_start + L + R
```

L: when the van comes (prior.py, personal.py)

- prior.py (the time-of-day prior):
  - L follows a shifted lognormal, log(L + 5) ~ N(mu0(t), S²), where t is the window start.
  - The shape over the day comes from NYC Access-A-Ride on-time data, fitted per hour and joined into a smooth daily curve.
  - The level and spread are calibrated to EBP's own figures: 94.7% of pickups inside the window over 369k trips.
  - No service before 05:00, so those windows raise an error.
- personal.py shifts that prior for a specific rider. It's a Bayesian regression with a rider-wide offset and a per-recurring-trip offset. Older trips count less, by a factor of 0.9 per week. With no history it returns exactly the prior. Nothing feeds it real history yet; that's step 2.

R: the ride (ride.py)

- A shared van takes longer than driving straight there:
  R = 2.23 × direct_drive × e^η, with η ~ N(0, 0.36²).
- The 2.23 factor is calibrated so EBP-like trips average EBP's reported 48.9-minute ride.
- The direct drive time comes from routing.py:
  - Google Routes with live traffic, or OpenRouteService (no traffic) as the fallback.
  - Departures are rounded to 15 minutes and cached on disk.
  - It now also geocodes addresses.
