# Browser LLM

This section documents the in-browser LLM feature: how language models run locally in the user's browser, how code generation is wired into the notebook, and the architecture decisions that keep the two features cleanly separated.

## Contents

| File                                 | What it covers                                                          |
| ------------------------------------ | ----------------------------------------------------------------------- |
| [how-it-works.md](./how-it-works.md) | End-to-end walkthrough — from button click to generated code cell       |
| [models.md](./models.md)             | Available models, hardware requirements, how to choose                  |
| [architecture.md](./architecture.md) | Code structure, DI slot pattern, cross-feature bridge, Reatom specifics |

## Quick orientation

The feature has two distinct parts:

**`features/web-llm`** — the self-contained LLM engine. Loads models, manages the `MLCEngine` instance, exposes a chat interface. The LLM Playground page uses this directly.

**`features/notebook` + `pages/notebook`** — the notebook never knows about WebLLM. Instead, `pages/notebook` wires the two together at startup via a _bridge_ that injects a code-generator function into a DI slot inside the notebook feature. See [architecture.md](./architecture.md).
