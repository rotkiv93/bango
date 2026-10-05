# @bango/core

The part of Bango that does not need Langium: the **plain data types** every package passes around, the **JSON helpers**, and the **worker client**. It exists so a page (or a renderer) can use the others' types and talk to an engine in a worker without loading a parser.

```ts
import type { InstanceState, AstDto, Problem } from '@bango/core';
import { toJsonSpec, mergeJson } from '@bango/core';
import { connectBango } from '@bango/core/client';

const bango = connectBango(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }));
```

| Import | |
|---|---|
| `@bango/core` | the types (`AstDto`, `Problem`, `InstanceState`, `FormSchema`, `EditOp`, `CompositionInfo`, `EngineApi`, `BangoApi`, ...) and `toJsonSpec`, `mergeJson` |
| `@bango/core/client` | `connectBango(worker)`: the same async API as a local `Bango`, over a Comlink endpoint |
| `@bango/core/bundle/client` | a self-contained ES module (Comlink inlined, ~6 KB) for pages without a bundler |

The other packages re-export the types they use (`import type { InstanceState } from '@bango/engine'` still works), so most code never imports `core` directly. The worker side, `serveBango()`, is in [`@bango/engine/worker`](../engine/README.md).

## Source layout

```
src/types.ts    DTOs and the EngineApi / BangoApi interfaces
src/json.ts     toJsonSpec (generic JSON of an AST) and mergeJson
src/client.ts   connectBango
src/bundle/     entry of the self-contained client
```
