# Orb Evaluation Report

Benchmark: orb-retrieval-benchmark-v1
Cases: 15

| Provider | Weighted | Avg ms | Exact hit | Candidate | Hallucination | Confidence | Telepathic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fixture-gold | 100 | 842.7 | 1 | 1 | 0 | 1 | n/a |
| fixture-noisy | 48.69 | 2720.7 | 0.3333 | 0.2361 | 0.2778 | 0.5 | n/a |

## fixture-gold

- No hallucination events detected.

## fixture-noisy

- direct_hive_conventions: 1 invalid artifact(s), reasons: title_mismatch
- direct_psych_profile: 1 invalid artifact(s), reasons: invalid_path
- candidate_openclaw: 1 invalid artifact(s), reasons: invalid_path
- direct_daily_psych_index: 1 invalid artifact(s), reasons: invalid_path
- direct_hive_index: 1 invalid artifact(s), reasons: title_mismatch

