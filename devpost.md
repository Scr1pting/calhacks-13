# Leeway

**The Problem:** 


## Prediction



### L: 

#### No Previous Rides

When a user hasn't taken any trips yet, the best we can do is to tell them how trips behave *in general*. 

| Metric | Jul '25–Apr '26 |
|---|---|
| Percent on time | 94.7% |
| 1–20 minutes past window | 4.42% |
| 21–59 minutes past window | 0.79% |
| 60+ minutes past window | 0.06% |

We assume that the delay is roughly **distributed like a shifted log-normal** and find the parameters that minimize the deviation from those values (our error). We fix the shift at -5 to allow for too early pickups.

![Fitted Shifted Lognormal](graphics/fitted-shifted-lognormal.svg)

This estimate is still very crude because the time of day makes a big difference: a van caught in rush hour traffic driving arrives late with higher probability.

We don't have access to more fine grained information for the East Bay. The transit authority in NYC publishes extensive reports on their paratransit system, including delays at different times of day. Our hypothesis is that at times **when the system in NYC is late more often, the system in East Bay is too**. 

In other words, if the the mean lateness in NY at time $t$ is $g(t)$ higher than regular, then the mean lateness in East Bay at time $t$ is also $g(t)$ higher than regular ($\,\mu(t) = \mu_{\text{base}} + g(t)\,$)

We still want to get the same probabilities for falling into the different buckets from the table earlier, so we optimize $\mu_{\text{base}}$ and our standard deviation so those match.

![](graphics/pickup-prior-17h.svg)

We noticed that our mean and therefore our offset $g(t)$ is very ragged, so we wanted to interpolate it using a polynomial. The results were slightly unrealistic (shoutout to the Runge phenomena)

![](graphics/runge-mu0.svg)

We ultimately settled for a **cubic spline to interpolate** the datapoints. We considered using a least squares fit but decided against it since each of the data points is backed by many datapoints.

#### Previous Trips

Once a user has done a couple of trips, we can use when they arrived to make better predictions.

We have three requirements:
- Older trips should be weighted less strongly
- Trips to the same location should count more than unrelated trips (those only tell us about general trends like whether vans in their neighborhood are late more often)
- We should trust a user's trips more the more trips they've done

To satisfy these
- We keep the as a prior (i.e. we mix it together with our other estimate, making )

(heteroscedastic noise!)


### R

Our initial idea was to use Google Maps via the Google Routes API to estimate how long a ride takes. This 

How can we address this?

A shared van takes longer than driving straight there. 





### Calculating the Arrival



Both L and R have a shifted log-normal distribution. Unfortunately, there exists no closed-form solution to its cumulative probability distribution.



Sample 2000 points and 


### Future: Waze for Paratransport



## Mobile App

## Simulation

