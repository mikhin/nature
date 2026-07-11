# nature

A spec-first kernel on three primitives — `nature`, `observe`, `action`. Your domain (shape, states, invariants, rules) lives in the spec, not smeared across the app. **Zero runtime dependencies, zero `any` in the public API.** State machines, diagrams and tests are *derived* from the spec at runtime, so they can't go stale.

```ts
import { nature, action, create, observe, T } from "nature"

const Me = nature("Me", { role: T.oneOf("customer", "guest") })

const Order = nature("Order", { total: T.num }, "draft").rules({
  "total is non-negative": o => o.total >= 0,   // o.total is inferred as number
})

const submit = action(Me, "submit", {
  on: Order, from: "draft", to: "pending",
  when: who => who.role === "customer",         // who.role: "customer" | "guest"
})

create(Me, "u1", { role: "customer" })
create(Order, "o1", { total: 42 }, "draft")

submit("u1", "o1")                              // { ok: true }
observe(Order, "o1", o => o.total)             // 42
```

## The three primitives

- **`nature(name, shape, initial?)`** — what a thing *is*: a `shape` of type-guard fields + `.rules({ invariants })`. The being's type is **inferred from the shape** (like zod, in ~3 lines, no codegen).
- **`observe(nature, id, ask)`** — pure read. Three outcomes: the value · `"absent"` (no such id — catches typos) · `"unknown"` (a field is genuinely unknowable, e.g. an external nature).
- **`action(actor, name, { on, from, to, when, effect })`** — the only mutator. Anchored on the **actor** (so authorization lives in `when`), targets `on`, gated by the target's state (`from`) and invariants.

Everything else composes from these: a decision table is an `observe` over data, a policy is `observe → action`, a saga is an `action` made of actions.

## Derived from the spec (never generated to disk)

```ts
machineOf(Order)   // { states, edges } — the state machine, assembled from all actions targeting it
analyze(Order)     // { initial, unreachable, deadEnds } — reachability check
mermaidOf(Order)   // a mermaid stateDiagram string
testsFor(Order)    // BDD cases derived from the machine + guards
```

## Also

- **`create(nature, id, props, init?)`** — spawn a being (validated through the same door as every write).
- **`sequence(name, steps)`** — fail-fast chain, no rollback.
- **`transaction(name, steps)`** — atomic: a failed step rolls back all *internal* state.
- **`stateOf(id)`**, **`reset()`** (clears all state — for tests), **`UNKNOWN`** (sentinel for unknowable field values).

## Install & run

```bash
npm install          # installs typescript, builds dist/ via prepare
npm run build        # tsc → dist/nature.js + nature.d.ts
npm run typecheck    # strictest tsconfig, no emit
npm run example      # node examples/demo.ts
```

Runs on anything that strips TS types (Node 24+, `tsx`, `bun`, `deno`) or on the built `dist/`. No runtime deps — safe for constrained VMs (e.g. Figma widgets).

## Known limits (v0)

- **State is a module-global.** All importers share one `world`/`registry`. Fine for a single app; use `reset()` for test isolation. Per-instance stores (injecting the backing store — e.g. a Figma synced-state adapter) is the planned next step.
- **`observe`/`action` trust the `(nature, id)` pair.** The id is the runtime key; the nature only supplies the type. Passing a mismatched pair is not caught at runtime yet.
- **`async` effects are not built.** Modeling the outside world as a nature (async actions + compensation/saga) is designed but deferred to the first real async flow.

## License

MIT
