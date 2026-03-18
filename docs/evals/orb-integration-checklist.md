# Orb Integration Checklist

This checklist ties together the direct chat endpoint, retrieval engine, orb UI, and provider comparison loop.

## Architecture Contract

- [ ] Direct retrieval chat goes to a dedicated orb endpoint, not OpenClaw
- [ ] OpenClaw remains limited to crons, agents, automations, and background labor
- [ ] The endpoint returns retrieval intent only: `resolve`, `candidates`, or `clarify`
- [ ] The endpoint contract normalizes cleanly to `orb-retrieval-response-v1`
- [ ] Every returned path validates against the current graph before any UI action
- [ ] The endpoint never fabricates note titles, file paths, or project state

## Retrieval Engine

- [ ] Graph or index source comes from the Obsidian vault extraction, not a parallel shadow database
- [ ] Path validation happens server-side before the response leaves the endpoint
- [ ] Retrieval scoring prefers exact note ids, titles, aliases, tags, and folder cues before semantic expansion
- [ ] Confidence thresholds map cleanly to `high`, `medium`, and `low`
- [ ] High confidence resolves directly
- [ ] Medium confidence returns 3 to 5 candidates
- [ ] Low confidence asks one narrow clarifying question
- [ ] Response payload stays short enough for the orb to feel minimal

## Frontend Orb

- [ ] `resolve` opens the validated file directly
- [ ] `candidates` renders a 3 to 5 option chooser with no hidden extra candidates
- [ ] `clarify` asks exactly one narrow question in the orb UI
- [ ] The orb never executes UI navigation on an unvalidated path
- [ ] The orb keeps the response visually minimal and retrieval-first
- [ ] Walt interpretation, synthesis, or advising is a separate path from retrieval

## Provider Comparison

- [ ] All providers are tested against the same `docs/evals/orb-benchmark-pack.json`
- [ ] All providers are normalized to the same response contract before scoring
- [ ] Comparison uses the actual current graph for path validation
- [ ] Objective scores and subjective telepathic scores are reported separately
- [ ] Hallucination events are listed explicitly, not hidden inside averages
- [ ] Failing providers are rejected on readiness bars even if the weighted average looks decent

## Current Endpoint Mapping

Current request body at `/api/orb/retrieve`:

```json
{
  "query": "open SOUL",
  "provider": "openai",
  "maxCandidates": 5
}
```

Current response shape:

```json
{
  "requestId": "uuid",
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "latencyMs": 812,
  "intent": {
    "target": "SOUL",
    "queryType": "note",
    "reason": "exact note target",
    "confidence": "high",
    "mode": "resolve",
    "clarificationQuestion": null
  },
  "result": {
    "type": "resolved_note",
    "note": {
      "path": "60-Knowledge/walt-config/SOUL.md",
      "title": "SOUL.md - Who You Are"
    }
  }
}
```

Normalization used by the harness:

- `intent.mode=resolve` => `action=resolve`, `resolved=result.note`
- `intent.mode=candidates` => `action=candidates`, `candidates=result.candidates`
- `intent.mode=clarify` => `action=clarify`, `question=result.question`

## Recommended Comparison Loop

1. Re-extract `public/graph.json` from the latest vault state.
2. Start the orb API server if you are evaluating live providers.
3. Run the benchmark pack through each provider using the same endpoint.
4. Inspect the hallucination list first.
5. Compare exact-hit accuracy and confidence behavior next.
6. Review candidate ordering on the medium-confidence cases.
7. Add telepathic feel ratings only after the objective pass.
8. Ship only the provider that clears the readiness bars in the scoring rubric.
