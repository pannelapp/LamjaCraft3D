# Wrapped Text seam fixtures

Both fixtures are synthetic native B-reps, not user-uploaded models. They reproduce the Open edge error class reported for position-sensitive longer Cut text on cones and spheres.

- `round-text-short-edge.json`: a rotated 15-character cone Cut produces a 3.13e-6 mm derived edge near a chart/source seam. One-sided cleanup leaves three open edges. Existing collective plane-constrained short-boundary resolution closes the canonical intersection without moving the placement or changing depth.
- `round-text-offset-corner.json`: a rotated 15-character sphere Cut crosses original triangle subdivisions. A straight source footprint has a bent offset edge; corners near the canonical collinearity threshold must remain eligible for reinsertion from incident walls. Actual roof triangulation and a canonical simplification budget no larger than the edge-insertion budget prevent one-sided seam changes.

The -0.001/+0.001 mm sphere perturbation also produces a 1.5e-9 mm² retained ear. Derived source-corner resolution removes that ear consistently before constructing the incident skins.

R244 checks both failing locations and perturbations without retries, positional jitter, tolerance changes, skipped letters or relaxed validation. Independent signed boundary integrals, exact normal depth, closed Float32 STL/native and an actual worker commit supplement graph validation.
