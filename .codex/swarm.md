# Codex Parallel Work Rules

Use this file only when Jason explicitly asks for sub-agents, delegation, or parallel work.

## Operating Model

- Keep critical-path work local when the next step depends on it immediately.
- Delegate bounded sidecar work that can proceed independently.
- One tack per agent. Do not give two agents the same unresolved problem.
- Use explicit file ownership for every worker.

## File Boundary Rule

- Split work by file boundaries, not by vague feature areas.
- If two agents need the same file, they do not run in parallel.
- Shared files move sequentially through a single owner or an integration pass.

## Agent Prompt Requirements

Every parallel worker prompt should include:

1. The exact files it owns
2. Files it must not touch
3. The acceptance criteria
4. The verification or screenshot proof required
5. A reminder that other agents may be editing nearby areas and nothing should be reverted casually

## Visual Work

- Visual branches still follow the screenshot loop.
- Each worker should verify its own visual changes before handing off.
- Merge phases only after the visual state is checked.

## Integration

- The main Codex tab remains the integrator.
- Review worker output before finalizing.
- Resolve conflicts by preserving the best validated behavior, not by whichever branch changed more code.
