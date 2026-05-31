# TARDIS-70 — Spike snapshot

Снапшот спайка, который доказал, что `quickjs-emscripten` + Web Worker —
рабочая база для execution runtime. Хранится как docs, потому что сами
spike-файлы будут удалены вместе с папкой `src/features/notebook/_spike/`
в финале эпика 01. Снапшот остаётся как референс: «вот так выглядел
минимальный рабочий прототип, прежде чем стек развили в production
runtime».

## Зачем нужен был спайк

Перед тем как тащить полноценный execution layer (Worker + QuickJS +
acorn-transform + Reatom-модель), нужно было убедиться:

- `quickjs-emscripten` ставится и работает в этом конкретном проекте;
- WASM грузится в Web Worker'е (там не main thread, контекст другой);
- Vite-стиль `new Worker(new URL('./worker.ts', import.meta.url), { type:
'module' })` собирается и в dev, и в Vitest через `@vitest/web-worker`;
- изоляция реальная (`typeof window` / `document` / `fetch` /
  `localStorage` === `'undefined'` внутри QuickJS);
- `setInterruptHandler(() => Date.now() > deadline)` прерывает
  `while(true)` за время дедлайна;
- `worker.terminate()` + respawn — рабочий способ для жёсткого
  остановки, после него следующий run работает;
- UI остаётся отзывчивым во время выполнения внутри worker'а.

## Результаты

### Vitest — 11 из 11 зелёные

**Standalone QuickJS (5/5):**

- `1+1 via console.log → 2` — 15 мс
- `sandbox isolation: all four host APIs are undefined inside QuickJS` —
  1 мс
- `infinite loop is interrupted by setInterruptHandler (deadline)` —
  202 мс (deadline 200 мс)
- `top-level await works` — 1 мс
- `thrown Error → ok=false, message in output` — 1 мс

**QuickJS inside Web Worker (6/6):**

- `1+1 via console.log → 2 (through worker)` — 22 мс
- `isolation holds inside worker too` — 1 мс
- `infinite loop is stopped within the deadline (interrupt OR terminate)`
  — 203 мс
- `worker respawns after timeout — next call works` — 203 мс
- `top-level await works through worker` — 1 мс
- `thrown Error through worker → ok=false, message in output` — 0 мс

### Ручная проверка в браузере

Страница примонтирована к роутингу как `/_spike/tardis-70` (не светится
в сайдбаре, доступна только по прямому URL). Все 5 пресетов работают
как ожидалось; во время `while(true)` с timeout=5000 ms UI остаётся
отзывчивым (можно скроллить, открывать DevTools, кликать другие кнопки).

## Структура снапшота

| Файл                                                 | Что внутри                                          |
| ---------------------------------------------------- | --------------------------------------------------- |
| [01-runtime-prototype.md](./01-runtime-prototype.md) | QuickJS sandbox + Worker entrypoint + host facade   |
| [02-tests.md](./02-tests.md)                         | Vitest spike-тесты (11 сценариев)                   |
| [03-manual-ui.md](./03-manual-ui.md)                 | UI-страница `/_spike/tardis-70` + регистрация роута |

## Что переедет в production runtime

| Артефакт спайка                         | Куда в эпике 01                                          | Что забираем                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runSmoke()` из `quickjs-smoke.ts`      | `runtime/quickjs.ts`                                     | паттерн: `getQuickJS` → `newContext` → `newFunction` для console → `setInterruptHandler` → `evalCode` + `resolvePromise` → `dispose` в `finally` |
| `runInSpikeWorker()` из `spike-host.ts` | `runtime/workerHost.ts`                                  | lifecycle: lazy singleton worker, timeout через `setTimeout` + `terminate()` + respawn, `runId` для dispatch                                     |
| `self.onmessage` из `spike-worker.ts`   | `runtime/worker.ts`                                      | Worker entrypoint, шаблон отправки `WorkerMsg`                                                                                                   |
| 11 сценариев из `spike.test.ts`         | `runtime/quickjs.test.ts` + `runtime/workerHost.test.ts` | переезжают 1-в-1, расширяются до полного AC покрытия                                                                                             |

## Что **не** переедет

- `SmokeResult { ok, output: string, isolation }` — это под smoke-тест.
  В проде — `OutputItem[]` (структурированный output, см. эпик 01 AC).
- Smoke-страница `SpikePage.tsx` — удаляется. В проде notebook-cell уже
  даёт UI для runCell.
- Роут `/_spike/tardis-70` — удаляется вместе со side-effect import в
  `App.tsx`.

## Удаление

Когда production runtime в `src/features/notebook/runtime/` смержен и
зелёный, выполнить:

```
git rm -r ui/src/features/notebook/_spike
```

И убрать строку `import '@/features/notebook/_spike/spike-route'` из
`ui/src/app/App.tsx`. Папка `ui/docs/_internal/TARDIS-70-spike/`
остаётся как docs-референс.
