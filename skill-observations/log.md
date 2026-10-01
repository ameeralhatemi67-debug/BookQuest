# Skill observations

No observations at session start, 2026-09-30.

### Observation 1: Match hosted limits before acceptance testing
- Status: OPEN
- Skill: deployment and verification workflows
- Evidence: A hosted Storage ceiling was lower than per-format limits. The app needed that ceiling in its public build configuration; local large-upload tests needed an explicit separate limit.
- Proposed improvement: Read effective service limits before publishing, validate the same values in UI and server policies, and make local test overrides explicit. Preserve undeclared hosted auth settings when applying a narrow configuration change.

### Observation 2: Finish layout edits before browser acceptance runs
- Status: OPEN
- Skill: browser verification workflows
- Evidence: Editing reader components during a multi-page browser run triggered development hot-reload failures and made later progress/navigation results unreliable. A stable restarted server separated those failures from actual control-overlap defects.
- Proposed improvement: Finish application edits before a browser batch. After a development-server error, restart it and repeat affected flows; read bounded diagnostics before changing business logic.

### Observation 3: Use the visible EPUB column for gesture coordinates
- Status: OPEN
- Skill: browser verification workflows
- Evidence: EPUB iframes can span an entire horizontal chapter. Coordinates computed from the middle of their bounding box fell outside the visible column; the same double-tap checks passed using the reading surface’s visible bounds.
- Proposed improvement: Base pointer coordinates on the visible reader container or a visible text range. Keep tests for outside-page gestures separate from in-page gestures.
