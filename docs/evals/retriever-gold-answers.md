# Retriever Gold Answers

This document records the expected gold behavior for the current Hive graph at `public/graph.json` with 1,447 nodes and 2,583 edges.

The laws this pack enforces:

- Obsidian is the source of truth.
- Retriever retrieves, Walt interprets.
- Direct retrieval chat does not route through OpenClaw.
- OpenClaw remains for crons, agents, automations, and background labor.
- All file paths must validate before UI action.
- High confidence resolves directly.
- Medium confidence returns 3 to 5 candidates.
- Low confidence asks one narrow clarifying question.

## Direct Resolve Cases

`direct_soul`
- Query: `open SOUL`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `60-Knowledge/walt-config/SOUL.md`
- Title: `SOUL.md - Who You Are`

`direct_walt_boot`
- Query: `take me to Walt boot`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `70-Ops/walt-boot.md`
- Title: `Walt Boot Sequence`

`direct_hive_conventions`
- Query: `show Hive conventions`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `20-Architecture/hive-conventions.md`
- Title: `The Hive: Conventions & Naming Standards`

`direct_psych_profile`
- Query: `open Jason's psychological profile`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `60-Knowledge/values-psychology/psychological-profile.md`
- Title: `Jason's Psychological Profile`

`direct_command_center`
- Query: `open command center`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `command-center.md`
- Title: `The Hive: Command Center`

`direct_sessions_browser`
- Query: `show sessions browser`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `10-Sessions/dashboard.md`
- Title: `Sessions Browser`

`direct_reindex_report`
- Query: `open the March 13 reindex report`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `70-Ops/health-reports/2026-03-13-reindex-report.md`
- Title: `Memory Service Reindex Report: 2026-03-13`

`direct_daily_psych_index`
- Query: `open the daily psych index`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `60-Knowledge/values-psychology/daily-psych/README.md`
- Title: `Daily Psychological Analysis`

`direct_hive_index`
- Query: `take me to the Hive index`
- Gold action: `resolve`
- Gold confidence: `high`
- Path: `index.md`
- Title: `The Hive`

## Candidate List Cases

`candidate_memory_service`
- Query: `open memory service`
- Gold action: `candidates`
- Gold confidence: `medium`
- Candidate 1: `20-Architecture/memory-service.md`
  Title: `Walt Memory Service: Semantic Search Layer`
- Candidate 2: `10-Sessions/2026-03-08-memory-service-architecture.md`
  Title: `Session: Memory Service Architecture + Vault Health + Librarian Deploy`
- Candidate 3: `10-Sessions/2026-03-08-memory-service-build-deploy.md`
  Title: `Session: Walt Memory Service Build and Deploy`
- Candidate 4: `10-Sessions/2026-03-08-memory-mcp-mmr-upgrade.md`
  Title: `Session: Memory Service MCP Integration + MMR + Auto-Start`

`candidate_openclaw`
- Query: `open OpenClaw`
- Gold action: `candidates`
- Gold confidence: `medium`
- Candidate 1: `60-Knowledge/chatgpt-history-anthology.md`
  Title: `ChatGPT/OpenClaw Chat History Anthology`
- Candidate 2: `10-Sessions/2026-03-09-openclaw-vault-oauth-recovery.md`
  Title: `Session: OpenClaw Vault OAuth Recovery`
- Candidate 3: `60-Knowledge/insights/openclaw-nuggets-mar-01-05.md`
  Title: `OpenClaw Nuggets: March 1-5, 2026`
- Candidate 4: `60-Knowledge/insights/openclaw-nuggets-feb-23-28.md`
  Title: `OpenClaw Nuggets: Feb 23-28, 2026`
- Candidate 5: `60-Knowledge/raw-data/openclaw-transcripts/2026-02-12-openclaw.md`
  Title: `OpenClaw Transcripts: 2026-02-12`

`candidate_anthology`
- Query: `open the anthology`
- Gold action: `candidates`
- Gold confidence: `medium`
- Candidate 1: `60-Knowledge/chatgpt-history-anthology.md`
  Title: `ChatGPT/OpenClaw Chat History Anthology`
- Candidate 2: `60-Knowledge/chat-history-anthology.md`
  Title: `Claude Chat History Anthology`
- Candidate 3: `10-Sessions/2026-03-08-anthology-completion.md`
  Title: `Session: Anthology Completion and Project History`

## Clarify Cases

`clarify_readme`
- Query: `open README`
- Gold action: `clarify`
- Gold confidence: `low`
- Gold question shape: ask which folder or project README Jason means
- Must not do: direct resolve to an arbitrary `README.md`

`clarify_dashboard`
- Query: `open dashboard`
- Gold action: `clarify`
- Gold confidence: `low`
- Gold question shape: ask whether Jason means the daily task tracker or the sessions browser
- Must not do: resolve immediately to `01-Daily/dashboard.md` or `10-Sessions/dashboard.md`

`clarify_open_loops`
- Query: `open open loops`
- Gold action: `clarify`
- Gold confidence: `low`
- Gold question shape: ask whether Jason means the knowledge note or the ops dashboard
- Real options:
  `60-Knowledge/open-loops.md`
  `70-Ops/open-loops.md`

## Notes

- The benchmark uses vault-relative paths because that is what the current graph stores and validates.
- If the graph is re-extracted and paths change, update the benchmark pack first, then rerun the harness.
- If a provider needs richer context, add a thin adapter at the direct chat endpoint. Do not push retrieval through OpenClaw.
