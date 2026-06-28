# Available Models

All models are **MLC-compiled** — a format specifically built for browser execution by the [MLC-LLM](https://llm.mlc.ai) project. Standard GGUF / Ollama models do not work with WebLLM; only models that have been compiled to MLC format and published to the MLC CDN can be used.

---

## Model list

| Model ID                                  | Size on disk | Best for                                                        |
| ----------------------------------------- | ------------ | --------------------------------------------------------------- |
| `Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC` | ~1 GB        | **Default for notebook.** Fast cold start, decent JS generation |
| `Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC`   | ~2 GB        | Best code quality / size tradeoff                               |
| `Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC`   | ~4.5 GB      | Best code quality overall                                       |
| `Qwen2.5-7B-Instruct-q4f16_1-MLC`         | ~5 GB        | General-purpose 7B (non-coder)                                  |
| `Llama-3.2-1B-Instruct-q4f32_1-MLC`       | ~0.8 GB      | Tiny, general-purpose, very fast                                |
| `Llama-3.2-3B-Instruct-q4f32_1-MLC`       | ~2 GB        | General reasoning                                               |
| `Llama-3.1-8B-Instruct-q4f32_1-MLC`       | ~5 GB        | Strong reasoning + code                                         |
| `Llama-3.2-3B-Instruct-q4f16_1-MLC`       | ~1.82 GB     | General-purpose, lighter quant of the 3B                        |
| `Phi-3.5-mini-instruct-q4f16_1-MLC`       | ~2.2 GB      | Microsoft model, compact                                        |
| `Mistral-7B-Instruct-v0.3-q4f16_1-MLC`    | ~4.5 GB      | Solid all-rounder                                               |
| `SmolLM2-1.7B-Instruct-q4f16_1-MLC`       | ~1 GB        | Ultra-light fallback                                            |

The list lives in `src/features/web-llm/model/webLlm.ts` → `AVAILABLE_MODELS`.

---

## Choosing a model

### For code generation in the notebook

The Qwen2.5-Coder series is purpose-trained on code. For most JS generation tasks:

- **1.5B** — loads in ~5–15 s on a modern GPU, good enough for simple snippets. **Used as the auto-load default.**
- **3B** — noticeably better output, still fast (~15–30 s load).
- **7B** — best results, needs a GPU with ~6 GB VRAM. Slow on CPU-only / WASM.

### For conversational use (Playground)

General-purpose models like Llama-3.2-3B, Qwen2.5-7B-Instruct or Phi-3.5-mini work well for explaining code or general Q&A.

> **Note (TARDIS-168).** The `DeepSeek-R1-Distill` family was removed from the catalog. In the browser 4-bit quant these chain-of-thought models proved unusable for code generation — degenerate reasoning loops, emitting Python for a JS task, and fused-identifier hallucinations that pass a syntax check but throw at runtime. The reasoning infrastructure (the `<think>` parser, think-token budget, sampling defaults, the "thinking" picker badge) stays in place for a future CoT model that actually works in-browser.

---

## Hardware requirements

| Setup                                                    | Expected experience                       |
| -------------------------------------------------------- | ----------------------------------------- |
| Modern GPU with WebGPU (M-series Mac, RTX 20+, RX 6000+) | 1.5B loads in 5–15 s, inference < 2 s     |
| Integrated GPU with WebGPU                               | 1.5B loads in 20–60 s, inference 5–15 s   |
| No WebGPU (WASM fallback)                                | Very slow — 1.5B may take several minutes |

Check WebGPU availability at [webgpureport.org](https://webgpureport.org).

---

## Caching

On first load the weights are downloaded from the MLC CDN and stored in **Cache Storage** (browser's service-worker cache). Subsequent loads read from the cache — no re-download. The cache persists across browser restarts until the user clears site data.

To see cached models in Chrome DevTools: **Application → Cache Storage → webllm/model-cache**.

---

## Adding a new model

1. Verify the model exists in the [MLC prebuilt library](https://llm.mlc.ai/docs/prebuilt_models.html).
2. Add its ID string to `AVAILABLE_MODELS` in `src/features/web-llm/model/webLlm.ts`.
3. That's it — the dropdown in both the Playground and the Notebook bar will pick it up automatically.

Models NOT in the MLC prebuilt library require a custom compilation step (out of scope for this project).
