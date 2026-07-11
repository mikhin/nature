// Example of using nature as a library.  run:  node examples/demo.ts
import { nature, action, create, observe, stateOf, sequence, transaction, analyze, mermaidOf, testsFor, scenariosOf, exampleResults, T, UNKNOWN } from "../src/nature.ts"

declare const console: { log: (...a: unknown[]) => void }

// ─── SPEC ─────────────────────────────────────────────────────────────────────
const Me = nature("Me", { role: T.oneOf("customer", "guest") })
const Person = nature("Person", { secret: T.unknown })                 // external nature: field is unknowable
const View = nature("View", { state: T.str })                          // business field "state" (machine lives in __state, no clash)
const Delivery = nature("Delivery", { price: T.num, note: T.str, gift: T.bool }, "idle").rules({
  "price is non-negative": s => s.price >= 0,                           // s.price is inferred as number
})

const order   = action(Me, "order",   { on: Delivery, from: "idle",    to: "ordered",   when: who => who.role === "customer" }) // who.role: "customer"|"guest"
  // executed scenarios — run at define time against the real guard, so they cannot lie:
  .example("a customer can order an idle delivery", { actor: { role: "customer" }, target: { __state: "idle", price: 1, note: "x", gift: false } }, "ok")
  .example("a guest cannot order", { actor: { role: "guest" }, target: { __state: "idle", price: 1, note: "x", gift: false } }, "blocked")
const pay     = action(Me, "pay",     { on: Delivery, from: "ordered", to: "paid" })
const receive = action(Me, "receive", { on: Delivery, from: "paid",    to: "done" })
const cancel  = action(Me, "cancel",  { on: Delivery, from: "ordered", to: "cancelled" })
const refund  = action(Me, "refund",  { on: Delivery, from: "paid",    to: "refunded" })
const strand  = action(Me, "strand",  { on: Delivery, from: "lost",    to: "void" })   // intentionally broken (for analyze)

// ─── RUN ──────────────────────────────────────────────────────────────────────
create(Me, "me", { role: "customer" }); create(Me, "guest", { role: "guest" })
create(Person, "alex", { secret: UNKNOWN })
create(View, "panel", { state: "expanded" })
create(Delivery, "parcel", { price: 300, note: "for tonight", gift: true }, "idle")

console.log("person (unknowable):   ", observe(Person, "alex", s => s.secret))       // unknown
console.log("typo in id:            ", observe(Delivery, "parcle", s => s.__state))  // absent
console.log("business field state:  ", observe(View, "panel", s => s.state))         // "expanded"

console.log("create bad state:      ", create(Delivery, "wrong", { price: 300, note: "x", gift: true }, "nonsense"))
console.log("create bad price:      ", create(Delivery, "free", { price: -5, note: "x", gift: true }, "idle"))

console.log("guest orders:          ", order("guest", "parcel"))                     // forbidden
const dinner = sequence("order dinner", [() => order("me", "parcel"), () => pay("me", "parcel"), () => receive("me", "parcel")])
console.log("dinner (me):           ", dinner())
console.log("delivery state:        ", stateOf("parcel"))
console.log("analyze Delivery:      ", analyze(Delivery))

// rollback: order→pay ok, cancel from paid is blocked → everything rolls back to idle
create(Delivery, "tx", { price: 100, note: "x", gift: false }, "idle")
const risky = transaction("pay+cancel", [() => order("me", "tx"), () => pay("me", "tx"), () => cancel("me", "tx")])
console.log("transaction (fails):   ", risky())
console.log("state after rollback:  ", stateOf("tx"), "(was idle — rolled back)")

console.log("\nmermaid Delivery:\n" + mermaidOf(Delivery))

// derived tests
const acts: Record<string, (a: string, t: string) => { ok: boolean }> = { order, pay, receive, cancel, refund, strand }
const suite = testsFor(Delivery)
let passed = 0
const fails: string[] = []
for (const c of suite) {
  const fn = acts[c.action]
  if (fn === undefined) continue
  const id = `t_${c.action}_${c.seed}`
  create(Delivery, id, { price: 300, note: "x", gift: true }, c.seed)
  const r = fn("me", id)
  if (r.ok === (c.expect === "ok") && (c.expect !== "ok" || stateOf(id) === c.to)) passed++
  else fails.push(c.name)
}
console.log("derived tests:         ", `${passed}/${suite.length} passed`, fails.length > 0 ? `✗ ${fails.join(", ")}` : "✓")

console.log("\nscenarios (from examples):\n" + scenariosOf(Delivery).join("\n"))
const exFails = exampleResults(Delivery).filter(r => !r.pass)
console.log("\nexamples:                ", exFails.length === 0 ? "all match ✓" : `✗ ${exFails.map(f => f.name).join(", ")}`)
