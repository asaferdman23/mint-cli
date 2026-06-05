## ADDED Requirements

### Requirement: Context strategy is recorded per task

The system SHALL record the retrieval tier used for each task as an ordinal
`context_strategy` (`C0` skeleton, `C1` lexical, `C2` hybrid+pinned, `C3`
hybrid+graph+priors) on the outcome row, so context effort is a learnable axis
alongside model.

#### Scenario: Strategy persisted on every run
- **WHEN** a task completes and an outcome is recorded
- **THEN** the outcome SHALL include the `context_strategy` that was used

#### Scenario: Legacy rows backfilled
- **WHEN** the migration runs against rows recorded before this change
- **THEN** those rows SHALL be assigned `C2` (the prior default) and flagged as
  inferred, so historical data is usable without claiming false precision

### Requirement: Substitution map aggregation

The system SHALL aggregate outcomes into a map keyed by
`(kind, complexity, context_strategy, model)` exposing sample count `n`, the
Wilson score lower bound of the success rate, average cost, and
cost-per-success. Eligibility SHALL use the Wilson lower bound, not the raw
success rate.

#### Scenario: Cell exposes a confidence-bounded success rate
- **WHEN** the map is built for a cell with successes and failures
- **THEN** the cell SHALL report the Wilson lower bound, which for small `n`
  SHALL be materially below the raw rate

#### Scenario: Cost-per-success not raw cost
- **WHEN** ranking cells for a `(kind, complexity)`
- **THEN** ranking SHALL use cost-per-success, so a cheap model that fails often
  ranks worse than a pricier model that succeeds

### Requirement: Safe learned down-routing

`resolveRoute` SHALL select the lowest cost-per-success cell whose Wilson lower
bound ≥ the configured quality bar `Q` and whose `n` ≥ `N_min`. When no cell
qualifies, it SHALL return the static frontier-default route from
`routing.default.json`. The failure mode SHALL always be holding at the safe
route, never guessing a cheaper one.

#### Scenario: Step down when data is confident
- **WHEN** a cheaper model+strategy cell has `p_lower ≥ Q` and `n ≥ N_min`
- **THEN** routing SHALL select it over the more expensive static default

#### Scenario: Hold at frontier on thin data
- **WHEN** no cell for the `(kind, complexity)` meets both `p_lower ≥ Q` and
  `n ≥ N_min`
- **THEN** routing SHALL return the static frontier-default route

#### Scenario: Disabled by default
- **WHEN** `brain.downrouting.enabled` is false (default)
- **THEN** routing SHALL behave exactly as static routing, ignoring the map

#### Scenario: Enabling with an empty map is a no-op
- **WHEN** down-routing is enabled but the map has no qualifying cells
- **THEN** every decision SHALL fall back to the static route

### Requirement: Capped, logged exploration

The system MAY run ε-greedy exploration to grow thin cells. Exploration SHALL be
bounded by `brain.downrouting.explorationRate`, SHALL NOT run on `complex`
complexity, and SHALL be logged and trace-tagged. It MUST NOT be silent.

#### Scenario: Exploration is observable
- **WHEN** an exploration step routes to a non-default cheaper cell
- **THEN** the choice SHALL be logged and recorded in the trace as exploration

#### Scenario: No exploration on complex tasks
- **WHEN** complexity is `complex`
- **THEN** no exploration SHALL occur; the static/qualified route is used

### Requirement: Global priors with per-repo overlay

The map SHALL merge shipped global priors with per-`cwd` learned cells, and a
local cell with sufficient `n` SHALL override the prior for that cell.

#### Scenario: Cold start uses priors
- **WHEN** a repo has no local outcomes for a `(kind, complexity)`
- **THEN** routing SHALL consult the global prior cells (still subject to the
  same Wilson + N_min gate)

#### Scenario: Local data overrides prior
- **WHEN** a local cell reaches `n ≥ N_min`
- **THEN** its measured values SHALL take precedence over the global prior for
  that cell

### Requirement: Down-route observability

`mint audit` SHALL surface the substitution map and which cells drive
down-routes, and each down-route SHALL be explained in the trace.

#### Scenario: Step-down is explained
- **WHEN** routing steps down to a cheaper model based on the map
- **THEN** the trace SHALL record the cell (model, strategy, p_lower, n) that
  justified the decision
