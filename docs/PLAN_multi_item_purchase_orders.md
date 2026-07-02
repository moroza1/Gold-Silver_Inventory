# Plan — Multi-Item Purchase Orders

**Goal:** Let a Maker add many line items to a single Purchase Order (e.g. `100g × 20`, `10g × 100`, ...), each with its own unit cost. The PO's total weight and total cost are auto-summed across all lines. The list, print view, edit flow, and intake step must all show every line rather than just the first.

**Cost model (decided):** Unit cost is per line. `PO.TotalCost = Σ(line.unit_cost × line.qty)` and `PO.TotalWeightGrams = Σ(denomination_weight × line.qty)`. The single "Total Cost" input on the form is removed in favor of a per-line cost, with a read-only running total.

---

## 1. Why this is mostly a presentation/DTO change, not a schema change

The persistence layer is **already multi-item** and needs no schema migration:

- `PurchaseOrder.Items : List<POItem>` and the `POItem` entity (`ProductId`, `OrderedQuantity`, `UnitCost`, `ReceivedQuantity`) already exist — `backend/PMIMS.Domain/Entities.cs:149`.
- `CreatePurchaseOrderAsync` and `UpdatePurchaseOrderAsync` already parse a JSON array and insert one `POItem` per element (`InventoryRepository.cs:130` and `:186`). Update already does delete-all-then-reinsert, which is correct for line edits.
- `GetPurchaseOrdersAsync` already `.Include(p => p.Items).ThenInclude(i => i.Product)` (`InventoryRepository.cs:812`).

So **no EF change, no `pmims.db` reseed required.** The single-item behavior is imposed entirely at the API read boundary and the frontend.

---

## 2. Backend changes

### 2a. GET read model — expose all lines (`PMIMSControllers.cs:391–407`)

Today the endpoint flattens to the first item only:

```csharp
var firstItem = po.Items?.FirstOrDefault();
poList.Add(new {
    ...
    product_id = firstItem?.ProductId ?? 1,
    qty = firstItem?.OrderedQuantity ?? 1
});
```

Add a full `items` array while **keeping `product_id`/`qty` as back-compat aliases** (first line + summed qty) so nothing that still reads them breaks mid-refactor:

```csharp
poList.Add(new {
    ... // unchanged fields
    product_id = firstItem?.ProductId ?? 1,          // keep: legacy alias = first line
    qty = po.Items?.Sum(i => i.OrderedQuantity) ?? 1, // now = total units across lines
    line_count = po.Items?.Count ?? 0,
    items = po.Items?.Select(i => new {
        product_id  = i.ProductId,
        qty         = i.OrderedQuantity,
        unit_cost   = i.UnitCost,
        received    = i.ReceivedQuantity,
        product_code = i.Product?.ProductCode,
        weight_grams = /* denomination weight — see note */ 0m
    })
});
```

Note on `weight_grams`: `POItem.Product` is a `MetalProduct`, whose per-unit weight lives on `Denomination` (not currently `.Include`d here). Either add `.ThenInclude(i => i.Product.Denomination)` in `GetPurchaseOrdersAsync`, or let the frontend resolve weight from the `products` catalog it already loads (it does this today in the weight effect). **Recommendation:** resolve weight on the frontend from `products` to keep the query lean; backend returns only `product_id`, `qty`, `unit_cost`.

### 2b. Server-side total recompute (defensive) — `CreatePurchaseOrderAsync` / repository

The DTO still carries `TotalWeightGrams`/`TotalCost` from the client. Since these are now derived, recompute them server-side from the items + denomination weights before saving, so a buggy or malicious client can't submit a PO whose header totals disagree with its lines. This is the one place worth a genuine backend logic add (a `Σ` over the parsed items, looking up denomination weight per `product_id`). If you prefer to keep the client as the source of truth for v1, skip this and just trust the posted totals — flag which you want.

### 2c. `CreatePORequest` DTO — no change

`CreatePORequest.Items : List<POItemDTO>` and `POItemDTO { product_id, qty, unit_cost }` already model exactly what we need (`PMIMSControllers.cs:1048–1049`).

---

## 3. Frontend changes (`frontend/src/App.tsx`)

### 3a. State — replace three scalars with a line array

Replace `poDenom` / `poQty` / `poCost` single-item state (`~:562–566`) with:

```ts
type POLine = { product_id: string; qty: number; unit_cost: number };
const [poLines, setPoLines] = useState<POLine[]>([{ product_id: '1', qty: 1, unit_cost: 0 }]);
```

Keep `poNum`, `poSupplier`, `poOrigin`. Derive `poWeight` and `poCost` (see 3c).

### 3b. Form — repeatable line rows (`~:2778–2811`)

Replace the single Denomination + Quantity + Cost blocks with a rows section:

- One row = `[ denomination <select> ] [ qty ] [ unit cost ] [ line subtotal ] [ 🗑 remove ]`.
- An **"+ Add line"** button appends `{ product_id, qty: 1, unit_cost: 0 }`.
- Remove is disabled when only one line remains.
- Below the rows: read-only **Total weight** and **Total cost** (summed), replacing the manual cost field and the auto-weight field.
- Fully bilingual (EN/AR) and gated by `canModify('purchase_orders')`, matching existing patterns.

### 3c. Derived totals — replace the weight `useEffect` (`~:912–916`)

The current effect multiplies one denomination weight × one qty. Replace with a `useMemo`/effect that sums across `poLines`, resolving each line's weight from the `products` catalog:

```ts
const poWeight = poLines.reduce((w, l) => {
  const p = products.find(pp => String(pp.product_id) === l.product_id);
  return w + (p?.weight_grams || 0) * l.qty;
}, 0);
const poCost = poLines.reduce((c, l) => c + l.unit_cost * l.qty, 0);
```

### 3d. Submit handlers — send the array (`handleCreatePO ~:1791`, `handleUpdatePO ~:1823`)

Replace the hardcoded `items: [{ ... single ... }]` with:

```ts
items: poLines.map(l => ({ product_id: parseInt(l.product_id) || 1, qty: l.qty, unit_cost: l.unit_cost })),
totalWeightGrams: poWeight,
totalCost: poCost,
```

Reset logic on success sets `poLines` back to a single default row.

### 3e. Edit populate (`~:2713–2720`)

The Amend button currently does `setPoDenom(po.product_id); setPoQty(po.qty)`. Change to hydrate from the new `po.items` array:

```ts
setPoLines((po.items && po.items.length
  ? po.items.map(i => ({ product_id: String(i.product_id), qty: i.qty, unit_cost: i.unit_cost }))
  : [{ product_id: String(po.product_id), qty: po.qty || 1, unit_cost: 0 }]));
```

(The fallback keeps old single-item POs editable.)

### 3f. PO list & Intake table (`~:2874` intake, plus the main PO table)

`<td>{po.qty || 1}</td>` now shows total units. Add a small line breakdown — either an expandable sub-row or an inline summary like `100g×20, 10g×100` built from `po.items` + the `products` catalog. Minimum viable: show total units + `po.line_count` lines; nicer: the itemized string.

### 3g. Print view (`~:2653–2664`)

Replace the single `Quantity` row with an **itemized table**: one row per line (`Denomination | Qty | Unit Cost | Subtotal`), then a totals row for weight and cost. This is the most visible "design change" on the printed PO.

---

## 4. Downstream touchpoint to verify — Intake

Receiving a shipment (`handleIntakePO` → `/vault/intake`, scanned serials mapped to `product_id`, `PMIMSControllers.cs:412`) already carries a `product_id` per scanned serial, so a multi-denomination PO is *conceptually* fine. But verify the intake screen lets the receiver pick among **all** the PO's denominations (not just the first) when logging serials, and that `ReceivedQuantity` reconciliation still lines up per `POItem`. This is the highest-risk integration point and should get an explicit test.

---

## 5. Build / verify checklist

1. `cd backend && dotnet build` — DTO/read-model changes compile.
2. `cd frontend && npm run build` (Vite) — ignore the known Arabic-RTL `tsc` TS17008/TS1005 false positives noted in AGENTS.md §7; trust the Vite build.
3. Manual/e2e: create a PO with two lines (`100g×20`, `10g×100`), confirm total weight/cost, submit → Maker-Checker, Amend it (add a third line), Approve, then Intake and confirm each denomination is receivable.
4. Existing single-item POs still render, edit, and print (back-compat via the `product_id`/`qty` aliases and the edit fallback).
5. Consider extending `PMIMS.Tests/PMIMSTests.cs` procurement test (`TC002`) with a 2-line PO assertion.

---

## 6. Files touched (summary)

| File | Change |
| :--- | :--- |
| `backend/.../Controllers/PMIMSControllers.cs` | GET read model returns `items[]` + aliases (§2a); optional total recompute (§2b) |
| `backend/.../InventoryRepository.cs` | Optional: include denomination weight / server-side totals (§2b) |
| `frontend/src/App.tsx` | Line-array state, repeatable form rows, derived totals, submit/edit/list/print (§3, §3g) |
| `backend/.../PMIMSTests.cs` | Optional: multi-line procurement test (§5) |

No schema change, **no `pmims.db` reseed needed.**

---

## 7. Open questions before implementing

1. **Server-side total recompute (§2b):** enforce on the backend, or trust client-computed totals for v1?
2. **List display (§3f):** full itemized `100g×20, 10g×100` string, or just total units + line count?
3. **Intake (§4):** in scope for this change, or handled separately? It's the one place that could break with mixed denominations.
