# Orb Scoring Rubric

This rubric keeps provider comparison grounded in retrieval behavior instead of essay quality.

## Weighted Score

Total score is normalized to 100 using only the metrics that are available for a given run.

| Metric | Weight | What It Measures |
| --- | ---: | --- |
| Latency | 0.15 | How fast the orb responds |
| Exact-hit accuracy | 0.25 | Whether high-confidence direct resolves hit the correct path |
| Candidate quality | 0.15 | Whether medium-confidence lists contain the right 3 to 5 options in a useful order |
| Hallucination resistance | 0.20 | Whether returned paths and titles are real and validated |
| Confidence behavior | 0.15 | Whether the provider chose resolve vs candidates vs clarify correctly |
| Telepathic feel | 0.10 | Human judgment of fast, minimal, nearly telepathic behavior |

## Metric Definitions

### 1. Latency

Measure wall-clock time from request send to normalized response received.

Raw metric:
- `latency_ms`

Score buckets:
- `<= 1200 ms` => `1.00`
- `<= 2500 ms` => `0.80`
- `<= 4000 ms` => `0.60`
- `<= 6000 ms` => `0.40`
- `> 6000 ms` => `0.20`

### 2. Exact-hit Accuracy

Applies only to gold cases whose expected action is `resolve`.

Case score:
- `1.00` when the provider returns `action=resolve`, `confidence=high`, and the resolved path matches the gold path exactly
- `0.00` otherwise

Provider metric:
- mean of direct-resolve case scores

### 3. Candidate Quality

Applies only to gold cases whose expected action is `candidates`.

What good looks like:
- action is `candidates`
- confidence is `medium`
- returned list size is between 3 and 5
- the expected candidates are present
- higher-priority candidates appear earlier

Case score formula:
- `0.25 * count_score`
- `0.50 * overlap_score`
- `0.25 * rank_score`

Definitions:
- `count_score`: `1.0` for 3 to 5 candidates, `0.5` for 2 candidates, `0.25` for 1 candidate, `0.0` otherwise
- `overlap_score`: fraction of gold candidate paths returned
- `rank_score`: NDCG-style ranking score against the ordered gold candidate list

Provider metric:
- mean of candidate-list case scores

### 4. Hallucination Rate

A hallucination event occurs when the provider returns any retrieval artifact that is not valid against the current graph.

Count as hallucinations:
- non-existent resolved path
- non-existent candidate path
- title that does not match the graph node for the returned path
- malformed retrieval object for a `resolve` or `candidates` action

Do not count as hallucinations:
- wrong choice among real files
- conservative clarify behavior

Provider metrics:
- `hallucination_rate = invalid_artifacts / total_artifacts`
- `hallucination_resistance = 1 - hallucination_rate`

### 5. Confidence Behavior

This is the law-enforcement metric.

Desired behavior:
- `resolve + high` when confidence is high
- `candidates + medium` when confidence is medium
- `clarify + low` when confidence is low

Case score:
- `1.00` when action and confidence both match the gold expectation
- `0.75` for clarify cases that ask a real narrow question but run slightly long
- `0.50` when action matches but confidence is one band off
- `0.00` when the action is wrong

For clarify cases, the question must:
- be present
- ask only one thing
- stay narrow enough to disambiguate the retrieval target

Provider metric:
- mean of all case scores

### 6. Telepathic Feel

This stays subjective on purpose. It should not contaminate the hard metrics.

Human raters score each provider from `1` to `5` after reading the responses for the pack.

Rubric:
- `5`: almost always instant, minimal, correct, and feels like it read Jason's mind
- `4`: mostly fast and correct, minor extra words or occasional shortlist when a direct hit was obvious
- `3`: usable but often hedges, over-explains, or needs extra steering
- `2`: frequently clumsy, verbose, or behaviorally mismatched
- `1`: unreliable, hallucinatory, or too slow to feel like the orb

Normalization:
- `telepathic_feel = rating / 5`

## Minimum Bar For Orb Readiness

- `hallucination_rate <= 0.02`
- `exact_hit_accuracy >= 0.90`
- `candidate_quality >= 0.80`
- `confidence_behavior >= 0.90`
- `latency_ms_avg <= 2500`
- `telepathic_feel >= 0.80`

If a provider misses the hallucination or confidence bars, it is not orb-ready even if the total weighted score looks good.
