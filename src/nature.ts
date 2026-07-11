// nature — a spec-first kernel on three words. zero-dep, zero-any (in the public API).
//
//   nature  — what a thing IS (a shape of type-guards + invariants)
//   observe — what I want to KNOW (pure read; absent / unknown are honest outcomes)
//   action  — what I want to DO (anchored on the actor; from = state, when = about the actor)
//
// Everything else (machine, diagram, tests, decision tables, policies) is a projection of the spec.

// ─── PUBLIC TYPES ─────────────────────────────────────────────────────────────
export type Field<A> = (v: unknown) => v is A                            // a field is a type guard that carries its type
export type Infer<S> = { [K in keyof S]: S[K] extends (v: unknown) => v is infer A ? A : never } // shape → field types
export type Being<S> = Infer<S> & { __state?: string }                  // a being = fields + machine state
export type Nature<S> = { name: string; initial: string | undefined; shape: S; invariants: Record<string, (s: Being<S>) => boolean> }
export type Result = { ok: true } | { ok: false; why: string }
export type Case = { name: string; action: string; seed: string; expect: "ok" | "blocked"; to: string | undefined }

// erased row in the store + erased spec: the dynamic core runs on unknown, without any
export type Row = { __state?: string; [k: string]: unknown }

// Where beings live. nature does NOT own storage — inject your own (a blob, a DB, synced state).
// The default is in-memory; a store adapter is responsible for its own serialization format.
export interface Store {
  get(id: string): Row | undefined
  set(id: string, row: Row): void
  delete(id: string): void
  snapshot(): Map<string, Row>          // for transaction rollback
  restore(snap: Map<string, Row>): void
}
type LNature = { name: string; initial: string | undefined; shape: Record<string, Field<unknown>>; invariants: Record<string, (s: Row) => boolean> }
type Spec = { name: string; onName: string; from: string | undefined; to: string | undefined; input: Record<string, Field<unknown>> | undefined; when: ((a: Row, t: Row, i: Row) => boolean) | undefined; effect: ((t: Row, i: Row) => Record<string, unknown>) | undefined }

// ─── FIELD TYPES (a zod replacement, zero-dep) ────────────────────────────────
export const T = {
  num: (v: unknown): v is number => typeof v === "number",
  str: (v: unknown): v is string => typeof v === "string",
  bool: (v: unknown): v is boolean => typeof v === "boolean",
  date: (v: unknown): v is Date => v instanceof Date && !Number.isNaN(v.getTime()), // real Date; the store adapter handles persistence format
  unknown: (_v: unknown): _v is unknown => true,                        // an unknowable field (external nature)
  oneOf: <const A extends readonly string[]>(...o: A): Field<A[number]> =>
    (v: unknown): v is A[number] => (o as readonly string[]).includes(v as string),
  list: <S>(shape: S): Field<Array<Infer<S>>> =>                        // a list of records, each matching `shape`
    (v: unknown): v is Array<Infer<S>> => Array.isArray(v) && v.every(item => {
      if (item === null || typeof item !== "object") return false
      const rec = item as Record<string, unknown>
      for (const k in shape as Record<string, unknown>) {
        const g = (shape as Record<string, (x: unknown) => boolean>)[k]
        if (g && !g(rec[k])) return false
      }
      return true
    }),
}

export const UNKNOWN = Symbol("unknown")     // a field value that is unavailable (observe → "unknown")

// default in-memory store; swap it with useStore() to put beings anywhere
class MapStore implements Store {
  private m = new Map<string, Row>()
  get(id: string): Row | undefined { return this.m.get(id) }
  set(id: string, row: Row): void { this.m.set(id, row) }
  delete(id: string): void { this.m.delete(id) }
  snapshot(): Map<string, Row> { return new Map(this.m) }
  restore(snap: Map<string, Row>): void { this.m = new Map(snap) }
}

let store: Store = new MapStore()            // state lives outside; nature just reads/writes through this
const registry = new Map<string, Spec[]>()   // the spec (actions keyed by target nature) — defined at load, not runtime state

/** Inject a custom store (blob, DB, Figma synced state, …). */
export function useStore(s: Store): void { store = s }

/** Clear all state and the registry (for tests / isolation). */
export function reset(): void { store.restore(new Map()); registry.clear() }

// nature: shape and invariants in TWO calls, otherwise S co-infers to unknown
export function nature<S>(name: string, shape: S, initial?: string) {
  const base: Nature<S> = { name, initial, shape, invariants: {} }
  return Object.assign(base, {
    rules(invariants: Record<string, (s: Being<NoInfer<S>>) => boolean>): Nature<S> {
      return { ...base, invariants }
    },
  })
}

// the machine is DERIVED from actions (from/to are data)
export function machineOf(n: { name: string }): { states: string[]; edges: Array<{ action: string; from: string | undefined; to: string | undefined }> } {
  const specs = (registry.get(n.name) ?? []).filter(s => s.from != null || s.to != null)
  const edges = specs.map(s => ({ action: s.name, from: s.from, to: s.to }))
  const states = [...new Set(edges.flatMap(e => [e.from, e.to]).filter((x): x is string => x != null))]
  return { states, edges }
}

// graph analysis: reachability from initial, unreachable states, dead ends
export function analyze(n: { name: string; initial: string | undefined }): { initial: string[]; unreachable: string[]; deadEnds: string[] } {
  const { states, edges } = machineOf(n)
  const incoming = new Set(edges.map(e => e.to))
  const outgoing = new Set(edges.map(e => e.from))
  const initial = n.initial != null ? [n.initial] : states.filter(s => !incoming.has(s))
  const reachable = new Set(initial)
  let frontier = [...initial]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const s of frontier) for (const e of edges) if (e.from === s && e.to != null && !reachable.has(e.to)) { reachable.add(e.to); next.push(e.to) }
    frontier = next
  }
  return { initial, unreachable: states.filter(s => !reachable.has(s)), deadEnds: states.filter(s => !outgoing.has(s)) }
}

// diagram — a projection of the machine (not codegen, computed on the fly)
export const mermaidOf = (n: { name: string }): string =>
  ["stateDiagram-v2", ...machineOf(n).edges.map(e => `  ${e.from} --> ${e.to}: ${e.action}`)].join("\n")

// BDD — test cases derived from the machine (no files → nothing to go stale)
export function testsFor(n: { name: string }): Case[] {
  const { states } = machineOf(n)
  const cases: Case[] = []
  for (const s of registry.get(n.name) ?? []) {
    if (s.from == null) continue
    cases.push({ name: `${s.name}: ${s.from}→${s.to}`, action: s.name, seed: s.from, expect: "ok", to: s.to })
    const wrong = states.find(st => st !== s.from)
    if (wrong !== undefined) cases.push({ name: `${s.name}: from "${wrong}" → blocked`, action: s.name, seed: wrong, expect: "blocked", to: undefined })
  }
  return cases
}

// the ONLY door into the store — both create and action go through here
function commit(n: LNature, id: string, next: Row): Result {
  const st = next.__state
  if (st !== undefined) {
    const { states } = machineOf(n)
    if (states.length > 0 && !states.includes(st)) return { ok: false, why: `state "${st}" not in machine ${n.name}` }
  }
  for (const k in n.shape) { const g = n.shape[k]; if (g && k in next && !g(next[k])) return { ok: false, why: `field ${k}: wrong type` } }
  for (const label in n.invariants) { const inv = n.invariants[label]; if (inv && !inv(next)) return { ok: false, why: `invariant: ${label}` } }
  store.set(id, { ...next })
  return { ok: true }
}

// observe: typed by the being. three outcomes — value · absent (no id) · unknown (field unavailable)
export function observe<S, R>(_n: Nature<S>, id: string, ask: (s: Being<S>) => R): R | "absent" | "unknown" {
  const row = store.get(id)
  if (row === undefined) return "absent"
  const r = ask(row as unknown as Being<S>)
  return (r as unknown) === UNKNOWN ? "unknown" : r
}

// action: anchored on the actor, targets on. from = state precondition, when = about the actor.
// No payload → a 2-arg call. Need a payload (addMilestone{label,date}, rename{title})? chain
// `.input(shape, { when, effect })` — a separate call so the input type is inferred cleanly.
export function action<AS, TS>(_actor: Nature<AS>, name: string, def: {
  on: Nature<TS>
  from?: string
  to?: string
  when?: (actor: Being<NoInfer<AS>>, target: Being<NoInfer<TS>>) => boolean
  effect?: (target: Being<NoInfer<TS>>) => Partial<Infer<NoInfer<TS>>>
}) {
  const w0 = def.when
  const e0 = def.effect
  const spec: Spec = {
    name, onName: def.on.name, from: def.from, to: def.to, input: undefined,
    when: w0 ? (a, t) => w0(a as unknown as Being<AS>, t as unknown as Being<TS>) : undefined,
    effect: e0 ? (t) => e0(t as unknown as Being<TS>) as Record<string, unknown> : undefined,
  }
  registry.set(def.on.name, [...(registry.get(def.on.name) ?? []), spec])
  const target = def.on as unknown as LNature
  // check runs from/input/when WITHOUT committing — the basis for both run() and .allowed()
  const check = (actorId: string, targetId: string, input?: Record<string, unknown>): Result => {
    const inp = (input ?? {}) as Row
    const who = store.get(actorId) ?? {}
    const t = store.get(targetId)
    if (t === undefined) return { ok: false, why: `no being "${targetId}"` }
    if (def.from != null && t.__state !== def.from) return { ok: false, why: `not allowed from "${t.__state}" (${name})` }
    if (spec.input) for (const k in spec.input) { const g = spec.input[k]; if (g && !g(inp[k])) return { ok: false, why: `input ${k}: wrong type` } }
    if (spec.when && !spec.when(who, t, inp)) return { ok: false, why: `forbidden (${name})` }
    return { ok: true }
  }
  const run = (actorId: string, targetId: string, input?: Record<string, unknown>): Result => {
    const c = check(actorId, targetId, input)
    if (!c.ok) return c
    const inp = (input ?? {}) as Row
    const t = store.get(targetId) as Row
    const patch = spec.effect ? spec.effect(t, inp) : {}
    return commit(target, targetId, { ...t, ...patch, ...(def.to != null ? { __state: def.to } : {}) })
  }
  const call = (actorId: string, targetId: string): Result => run(actorId, targetId)
  return Object.assign(call, {
    // would this action proceed right now? drives UI (disable a button) with NO drift from the spec
    allowed: (actorId: string, targetId: string): boolean => check(actorId, targetId).ok,
    // add a typed payload — IS is inferred from `shape` and reused in `handlers` (cross-arg, reliable)
    input<IS extends Record<string, Field<unknown>>>(shape: IS, handlers: {
      when?: (actor: Being<NoInfer<AS>>, target: Being<NoInfer<TS>>, input: Infer<IS>) => boolean
      effect?: (target: Being<NoInfer<TS>>, input: Infer<IS>) => Partial<Infer<NoInfer<TS>>>
    }) {
      spec.input = shape
      spec.when = handlers.when ? (a, t, i) => handlers.when!(a as unknown as Being<AS>, t as unknown as Being<TS>, i as unknown as Infer<IS>) : undefined
      spec.effect = handlers.effect ? (t, i) => handlers.effect!(t as unknown as Being<TS>, i as unknown as Infer<IS>) as Record<string, unknown> : undefined
      const runIn = (actorId: string, targetId: string, input: Infer<IS>): Result => run(actorId, targetId, input as Record<string, unknown>)
      return Object.assign(runIn, {
        allowed: (actorId: string, targetId: string, input: Infer<IS>): boolean => check(actorId, targetId, input as Record<string, unknown>).ok,
      })
    },
  })
}

// spawn a being (validated through the same door as every write)
export function create<S>(n: Nature<S>, id: string, props: Infer<S>, init?: string): Result {
  const row = { ...(props as Record<string, unknown>), ...(init != null ? { __state: init } : {}) }
  return commit(n as unknown as LNature, id, row)
}

// remove a being (delete). validated: the being must exist.
export function destroy<S>(_n: Nature<S>, id: string): Result {
  if (store.get(id) === undefined) return { ok: false, why: `no being "${id}"` }
  store.delete(id)
  return { ok: true }
}

// current machine state of a being
export const stateOf = (id: string): string | undefined | "absent" => { const r = store.get(id); return r === undefined ? "absent" : r.__state }

// sequence: fail-fast, NO rollback (the name is honest)
export const sequence = (name: string, steps: Array<() => Result>) => (): Result => {
  for (const step of steps) { const r = step(); if (!r.ok) return { ok: false, why: `${name}: ${r.why}` } }
  return { ok: true }
}

// transaction: a failed step rolls back all internal state.
// NOTE: only state in the store is rolled back; external effects cannot be undone — that is compensation/saga.
export const transaction = (name: string, steps: Array<() => Result>) => (): Result => {
  const backup = store.snapshot()               // commit stores a fresh row object → a shallow snapshot is enough
  for (const step of steps) {
    const r = step()
    if (!r.ok) { store.restore(backup); return { ok: false, why: `${name} rolled back: ${r.why}` } }
  }
  return { ok: true }
}
