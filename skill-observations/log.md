# Skill observations

No observations at session start, 2026-09-30.

### Observation 1: Match hosted limits before acceptance testing
- Status: OPEN
- Skill: deployment and verification workflows
- Evidence: A hosted Storage ceiling was lower than per-format limits. The app needed that ceiling in its public build configuration; local large-upload tests needed an explicit separate limit.
- Proposed improvement: Read effective service limits before publishing, validate the same values in UI and server policies, and make local test overrides explicit. Preserve undeclared hosted auth settings when applying a narrow configuration change.
