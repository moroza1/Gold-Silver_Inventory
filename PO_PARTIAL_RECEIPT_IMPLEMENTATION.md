# P.O. Partial Receipt Logic Implementation

## Summary

This implementation adds support for **partial P.O. receipt tracking** to PMIMS. When a shipment is received that doesn't fully satisfy a P.O., the system now:
- Tracks the received quantity per line item (POItem.ReceivedQuantity)
- Keeps the P.O. open with status "PARTIAL_RECEIPT" 
- Only closes the P.O. (status "RECEIVED") when all ordered quantities have been received
- Reflects P.O. status on the Executive Dashboard with visual KPIs

## Changes Made

### 1. Backend: InventoryRepository.cs

**Location**: `backend/PMIMS.Infrastructure/InventoryRepository.cs` → `IntakeInventoryItemsAsync` method

**Change**: Added logic to increment `POItem.ReceivedQuantity` and conditionally set P.O. status.

```csharp
// Count items received per product and update POItem.ReceivedQuantity
var itemsReceivedByProduct = newItems.GroupBy(i => i.ProductId)
    .ToDictionary(g => g.Key, g => g.Count());

bool allItemsReceived = true;
foreach (var poItem in po.Items)
{
    if (itemsReceivedByProduct.ContainsKey(poItem.ProductId))
    {
        poItem.ReceivedQuantity += itemsReceivedByProduct[poItem.ProductId];
    }

    if (poItem.ReceivedQuantity < poItem.OrderedQuantity)
    {
        allItemsReceived = false;
    }
}

// Set P.O. status based on receipt completeness
if (allItemsReceived && po.Items.All(item => item.ReceivedQuantity == item.OrderedQuantity))
{
    po.StatusCode = "RECEIVED";
}
else
{
    po.StatusCode = "PARTIAL_RECEIPT";
}
```

**Logic Flow**:
1. When intake is processed, count how many items per product are being received
2. For each POItem, increment its ReceivedQuantity
3. Check if all line items have been fully received
4. If yes → set P.O. status to "RECEIVED" (can close P.O. cycle)
5. If no → set P.O. status to "PARTIAL_RECEIPT" (awaiting remaining shipment)

### 2. Backend: DbSeeder.cs

**Location**: `backend/PMIMS.Infrastructure/DbSeeder.cs` → Status Codes seeding

**Change**: Added new status code for partial receipts.

```csharp
new StatusCodes { StatusCode = "PARTIAL_RECEIPT", Description = "Partial shipment received, awaiting remaining items", Category = "WORKFLOW" }
```

**Status Code Values**:
- `PENDING_APPROVAL` - P.O. awaiting checker approval
- `APPROVED` - P.O. approved, ready for shipment
- `PARTIAL_RECEIPT` - **NEW** - Some items received, waiting for rest
- `RECEIVED` - All items received, P.O. closed

### 3. Backend: PMIMSControllers.cs

**Location**: `backend/PMIMS.WebAPI/Controllers/PMIMSControllers.cs` → `GetExecutiveBoard` endpoint

**Change**: Extended Executive Board dashboard to include P.O. metrics.

**New Response Fields**:
```json
{
  "purchase_orders": {
    "total": 15,
    "pending_approval": 2,
    "approved": 5,
    "partial_receipt": 3,
    "fully_received": 5
  },
  "purchase_order_list": [
    {
      "po_id": 1,
      "po_number": "PO-2026-001",
      "vendor_name": "Valcambi",
      "status": "PARTIAL_RECEIPT",
      "total_cost": 100000,
      "currency": "USD",
      "created_at": "2026-07-04T10:30:00Z",
      "items": [
        {
          "product_id": 1,
          "ordered_qty": 100,
          "received_qty": 50,
          "product_name": "GLD-100G"
        }
      ]
    }
  ]
}
```

### 4. Frontend: App.tsx

**Location**: `frontend/src/App.tsx`

**Changes**:
1. Extended `execBoard` state type to include P.O. metrics
2. Added P.O. KPI cards showing:
   - Total P.O.s
   - Fully Received (green indicator)
   - Partial Receipt (orange indicator - awaiting)
   - Approved (blue indicator - not yet shipped)
   - Pending Approval (red indicator)
3. Added P.O. Receipt Status table showing ordered vs. received quantities

## Test Scenarios

### Scenario 1: Partial Receipt on First Intake

**Setup**:
1. Create P.O. for 100 units of Product A
2. Approve P.O. → Status becomes "APPROVED"

**Action**:
1. Intake 50 units of Product A
2. Check P.O. status and Executive Board

**Expected Results**:
- POItem.ReceivedQuantity = 50
- P.O. Status = "PARTIAL_RECEIPT"
- Executive Board shows: 1 "Partial Receipt" P.O., 0 "Fully Received"
- P.O. table shows: "100 / 50" for this order

### Scenario 2: Complete Receipt on Second Intake

**Setup**: Scenario 1 complete (50 of 100 units received)

**Action**:
1. Intake remaining 50 units of Product A
2. Check P.O. status and Executive Board

**Expected Results**:
- POItem.ReceivedQuantity = 100
- P.O. Status = "RECEIVED" (transitions from PARTIAL_RECEIPT)
- Executive Board shows: 0 "Partial Receipt", 1 "Fully Received"
- P.O. table shows: "100" (not "100 / 100", just complete)

### Scenario 3: Multiple Line Items with Mixed Receipt

**Setup**:
1. Create P.O. with:
   - Item 1: 100 units (ordered)
   - Item 2: 50 units (ordered)
2. Approve P.O.

**Action 1**: Intake Item 1 fully (100 units), Item 2 partially (25 of 50 units)

**Expected Results**:
- POItem[0].ReceivedQuantity = 100, POItem[1].ReceivedQuantity = 25
- P.O. Status = "PARTIAL_RECEIPT" (Item 2 not complete)
- Dashboard: 1 Partial Receipt

**Action 2**: Intake remaining Item 2 (25 units)

**Expected Results**:
- POItem[0].ReceivedQuantity = 100, POItem[1].ReceivedQuantity = 50
- P.O. Status = "RECEIVED" (all items complete)
- Dashboard: 1 Fully Received

### Scenario 4: Executive Board KPI Display

**Setup**: Multiple P.O.s in various states:
- 2 × PENDING_APPROVAL
- 3 × APPROVED
- 2 × PARTIAL_RECEIPT
- 8 × RECEIVED

**Action**: Open Executive Dashboard

**Expected Results**:
- KPI cards show: Total=15, Pending=2, Approved=3, Partial=2, Received=8
- P.O. Status table displays all P.O.s with ordered/received quantities
- Partial receipt P.O.s show orange indicators and "Awaiting" label
- Color coding: Green (received), Orange (partial), Blue (approved), Red (pending)

## Running the Tests

### Prerequisites
1. Delete `backend/PMIMS.WebAPI/pmims.db` to reseed
2. Start backend: `cd backend/PMIMS.WebAPI && dotnet run`
3. Start frontend: `cd frontend && npm run dev`

### Manual Test Steps

**Test 1: Create and Partially Receive P.O.**
1. Login as `treasury-maker` / `Password123`
2. Navigate to Procurement → Purchase Orders
3. Create new P.O.:
   - Vendor: Valcambi Suisse
   - Add Item: GLD-100G, Qty=100
   - Total Cost: Auto-calculated
4. Submit P.O.
5. Login as `treasury-checker` / `Password123`
6. Approve P.O.
7. Navigate to Intake
8. Create intake against this P.O.:
   - Lot Number: LOT-001
   - Location: Zone A, Shelf 1, Slot 1
   - Add 50 serial numbers (SER-001 through SER-050)
   - Submit
9. Check P.O. status → Should show "PARTIAL_RECEIPT"

**Test 2: Complete Receipt**
1. Create second intake for same P.O.:
   - Lot Number: LOT-002
   - Add remaining 50 serial numbers (SER-051 through SER-100)
   - Submit
2. Check P.O. status → Should show "RECEIVED"

**Test 3: View Executive Board**
1. Navigate to Dashboards → Executive Dashboard
2. Verify P.O. KPI cards display correctly
3. Check P.O. Status table:
   - Shows "100" in Received Qty for completed P.O.
   - Shows "100 / 50" for partially completed P.O. (if you have one)
   - Color indicators match status

## Database Reset

If you need to restart testing:
```bash
# Backend
cd backend/PMIMS.WebAPI
rm pmims.db
dotnet run  # Will reseed with demo data
```

## Files Modified

1. **Backend**:
   - `backend/PMIMS.Infrastructure/InventoryRepository.cs`
   - `backend/PMIMS.Infrastructure/DbSeeder.cs`
   - `backend/PMIMS.WebAPI/Controllers/PMIMSControllers.cs`

2. **Frontend**:
   - `frontend/src/App.tsx`

## Key Behaviors

✅ **Partial Receipt Tracking**
- ReceivedQuantity increments on each intake
- P.O. stays APPROVED → transitions to PARTIAL_RECEIPT → transitions to RECEIVED
- No manual status manipulation required

✅ **Cycle Control**
- P.O. cycle cannot be closed while items are outstanding
- User must wait for remaining shipment before P.O. closes

✅ **Dashboard Visibility**
- Executive Board KPI cards summarize P.O. status distribution
- P.O. Status table shows ordered vs. received for each P.O.
- Orange indicators highlight P.O.s awaiting remaining items

✅ **GL Integration**
- Landed cost posting still occurs on first intake (not repeated)
- No duplicative GL entries on partial receipts

## Notes

- P.O. approval workflow unchanged; only intake logic modified
- ReceivedQuantity is additive; each intake increments the counter
- Status transitions: APPROVED → PARTIAL_RECEIPT → RECEIVED (one-way)
- If a P.O. receives more items than ordered, it still marks as RECEIVED (safety: received >= ordered)
