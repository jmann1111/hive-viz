# Codex Lessons Learned

Read this file before non-trivial work in this repo.

When a new lesson is needed, append it using:

`### L-XXX: Title`

- **Context:** What you were doing
- **Mistake:** What went wrong
- **Fix:** The correct approach
- **Rule:** One-line rule to prevent recurrence

## Active Lessons

### L-001: Test through the actual execution path
- **Context:** Verifying behavior in local tools and automation.
- **Mistake:** Trusting a shortcut or partial path instead of the real user path.
- **Fix:** Run the feature the way the user actually experiences it, then inspect the result.
- **Rule:** Verification is only real if it uses the actual execution path.

### L-002: Evidence first, theory second
- **Context:** Debugging visual, build, auth, or runtime failures.
- **Mistake:** Guessing at causes before reading logs, output, or the current code.
- **Fix:** Gather evidence first, then form the fix from the evidence.
- **Rule:** Read the logs and inspect the code before proposing a cause.

### L-003: No em dashes anywhere
- **Context:** Repo content, Hive content, notes, and user-facing text.
- **Mistake:** Writing em dashes out of habit.
- **Fix:** Rewrite with commas, colons, or plain hyphens.
- **Rule:** Zero em dashes in any written output or file content.

### L-004: Read Hive conventions before vault writes
- **Context:** Any task that edits The Hive vault or vault-derived docs.
- **Mistake:** Writing vault content without checking the naming and metadata law first.
- **Fix:** Read `hive-conventions.md` before touching vault content.
- **Rule:** No Hive write happens before reading `hive-conventions.md`.

### L-005: Visual work requires frame-by-frame inspection
- **Context:** UI, layout, WebGL, camera, color, or interaction changes.
- **Mistake:** Stacking several visual changes before looking at the rendered result.
- **Fix:** Change one thing, reload, screenshot, inspect, then continue.
- **Rule:** One visual change, one screenshot, one decision.

### L-006: Functional tool beats spectacle
- **Context:** Feature decisions in Hive Viz.
- **Mistake:** Favoring cinematic or decorative ideas over browsing and reading utility.
- **Fix:** Bias toward file browsing, selection clarity, readable content, and useful navigation.
- **Rule:** If a visual idea does not improve function, it is lower priority.

### L-007: Camera motion must stay interruptible
- **Context:** Navigation, click-to-fly, orbit transitions, and focus moves.
- **Mistake:** Introducing cinematic state machines, roll, FOV tricks, or control toggling that hurts feel.
- **Fix:** Use simple smoothing that can be interrupted instantly by user input.
- **Rule:** Camera moves must be smooth, minimal, and interruptible.

### L-008: Split parallel work by file boundaries
- **Context:** Multi-agent or parallel implementation work.
- **Mistake:** Splitting by feature while multiple workers touch the same files.
- **Fix:** Give each worker a disjoint write set and explicit ownership.
- **Rule:** Parallel work is file-boundary work, not overlapping feature work.

### L-009: Show proof, not promises
- **Context:** Reporting status back to Jason.
- **Mistake:** Saying a thing is fixed before capturing evidence.
- **Fix:** Include the check you ran, the screenshot you inspected, or the log result you saw.
- **Rule:** Never declare victory without verification evidence.

### L-010: Lead with the answer
- **Context:** User interaction during implementation and debugging.
- **Mistake:** Pushing uncertainty back to Jason before doing obvious discovery work yourself.
- **Fix:** Investigate first, answer directly, then ask only the question that remains necessary.
- **Rule:** Bring Jason a conclusion or a narrowed decision, not raw ambiguity.

### L-011: Never stack ambient bobbing onto world navigation
- **Context:** Vergil idle and patrol motion in the live scene.
- **Mistake:** Applying hover directly to the actor's world position after steering, which makes ambient motion read as twitchy and unstable.
- **Fix:** Keep navigation on the world/root transform and move hover or sway into a separate visual rig or child layer.
- **Rule:** Ambient float belongs on a presentation layer, not the navigation transform.

### L-012: Stop immediately on repo or worktree mismatch
- **Context:** Visual work split between the real galaxy-skybox worktree and an older donor prototype repo.
- **Mistake:** Continuing implementation after signs that the active repo was not the one the user meant, which produced valid work in the wrong place.
- **Fix:** Verify the absolute repo path before substantial edits and stop the moment the runtime, files, or visuals do not match the active product branch.
- **Rule:** If the repo identity is in doubt, pause and verify the exact worktree before writing code.
