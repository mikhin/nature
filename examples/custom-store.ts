// Proof: nature does not own storage. Inject any store, the kernel is unchanged.
// Also shows the new T.date field and destroy() (delete).  run: node examples/custom-store.ts
import { nature, action, create, observe, destroy, stateOf, useStore, T, type Store, type Row } from "../src/nature.ts"

declare const console: { log: (...a: unknown[]) => void }

// A store backed by a single serialized blob (like a Figma synced-state value),
// serializing Dates to ISO on write and reviving them on read — nature never sees this.
class BlobStore implements Store {
  blob: string = "{}"                                     // the one place bytes live
  private read(): Record<string, Row> { return JSON.parse(this.blob, (_k, v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v) as Record<string, Row> }
  private write(all: Record<string, Row>): void { this.blob = JSON.stringify(all) }
  get(id: string): Row | undefined { return this.read()[id] }
  set(id: string, row: Row): void { const all = this.read(); all[id] = row; this.write(all) }
  delete(id: string): void { const all = this.read(); delete all[id]; this.write(all) }
  snapshot(): Map<string, Row> { return new Map(Object.entries(this.read())) }
  restore(snap: Map<string, Row>): void { this.write(Object.fromEntries(snap)) }
}

const blob = new BlobStore()
useStore(blob)                                           // ← swap the store; nothing else changes

// ─── same spec API as always ──────────────────────────────────────────────────
const Me = nature("Me", { role: T.oneOf("owner", "guest") })
const Milestone = nature("Milestone", { label: T.str, date: T.date }, "planned").rules({
  "label is not empty": m => m.label.length > 0,
})
const reach = action(Me, "reach", { on: Milestone, from: "planned", to: "reached", when: who => who.role === "owner" })

create(Me, "me", { role: "owner" })
create(Milestone, "kickoff", { label: "Kickoff", date: new Date("2026-09-01") }, "planned")

console.log("date field stored:   ", observe(Milestone, "kickoff", m => m.date.toISOString().slice(0, 10))) // 2026-09-01
console.log("bad date rejected:   ", create(Milestone, "bad", { label: "x", date: new Date("nonsense") }, "planned")) // T.date guards
console.log("reach (owner):       ", reach("me", "kickoff"), "→ state:", stateOf("kickoff"))                  // ok → reached

console.log("destroy kickoff:     ", destroy(Milestone, "kickoff"))                                          // ok
console.log("after destroy:       ", observe(Milestone, "kickoff", m => m.label))                            // absent

console.log("\nthe raw blob nature never touched:\n" + blob.blob)                                            // only "me" remains
