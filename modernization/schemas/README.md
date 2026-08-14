# schemas/

Reserved for Phase 2.6. Type-only stubs for the future Generative Agents
extension points defined in `AGENTs.md`:

- `ObservationEvent`  — emitted by the deterministic core on state change.
- `WorldSnapshot`     — read-only state for agents.
- `AgentIntent`       — what an agent wants to do (must pass rule validator).
- `DialogueCandidate` — alternative dialogue lines an agent can propose.
- `CharacterScheduleProvider` — replaces deterministic schedule with agent plan.

Phase 1 ships no code here. Phase 2.6 lands type-only `.ts` files; behavior
remains disabled, no LLM call sites may be introduced.