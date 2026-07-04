# Fix: Expandable P.O. Items Display in Receive Shipments

## Problem
When expanding a P.O. row in the "Receive Shipments" screen, no items were displayed. The chevron toggled correctly, but the items list remained empty.

## Root Cause
The feature was missing from the codebase. The expandable P.O. functionality needed to be implemented to allow users to preview line items before opening the intake modal.

## Solution Implemented

### 1. Added State Variable
```javascript
const [expandedPOId, setExpandedPOId] = useState<number | null>(null);
```
Tracks which P.O. row is currently expanded.

### 2. Enhanced P.O. Row Rendering
Modified the Receive Shipments table to:
- Add a clickable chevron icon (►/▼) in the first column
- Make the entire P.O. row clickable to expand/collapse
- Show/hide the items sub-row based on expansion state

### 3. Added Items Display Sub-Row
When expanded, shows:
- **Product Name**: Metal name + denomination (e.g., "Gold 100g")
- **Purity Level**: If available (e.g., "999.9")
- **Quantity**: Number of units ordered (`item.qty` from API response)
- **Color Coding**: Blue headers, green quantities

### 4. Used Correct API Field Names
The backend `/api/purchase-orders` endpoint returns items with:
- `qty` (not `quantity`) = OrderedQuantity
- `received` (optional) = ReceivedQuantity for partial receipt tracking
- `product_id` = Link to product catalog
- `product_code` = Item code (e.g., "AU-100G-TURK")

## How It Works

### User Workflow
```
1. Open "Receive Shipments" screen
   ↓ See list of APPROVED purchase orders

2. Click chevron icon (►) next to a P.O.
   ↓ Row expands and shows items below

3. See all line items in the P.O.
   - Product names, quantities, purity levels

4. Review what needs to be received
   - Understand item breakdown before scanning

5. Click "Receive Shipment" to open intake modal
   - Know exactly which items to scan

6. Click chevron again (▼) to collapse
```

### Visual Example
```
Before Expand:
┌─ PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive]

After Expand:
┌─▼ PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive]
│
│  Items to Receive:
│  ├─ Gold 100g (999.9 Purity)          10 units
│  └─ Silver 1kg (999 Purity)            5 units
```

## Technical Details

### Backend API Response Structure
```javascript
{
  po_id: 123,
  po_number: "PO-2026-001",
  supplier: "Valcambi",
  status_code: "APPROVED",
  items: [
    {
      product_id: 1,
      product_code: "AU-100G-TURK",
      qty: 10,           // ← Ordered quantity
      unit_cost: 7320,
      received: 0        // ← For partial receipt tracking
    },
    {
      product_id: 5,
      product_code: "SV-1KG-SWIS",
      qty: 5,
      unit_cost: 280,
      received: 0
    }
  ]
}
```

### Frontend State Management
```javascript
// Track expansion state
const [expandedPOId, setExpandedPOId] = useState<number | null>(null);

// Toggle on row click
onClick={() => setExpandedPOId(expandedPOId === po.po_id ? null : po.po_id)}

// Show items only when expanded
{expandedPOId === po.po_id && po.items && po.items.length > 0 && (
  // Render items sub-row
)}
```

## Key Features

✅ **Click to Expand/Collapse**
- Click chevron or anywhere on P.O. row to toggle
- One P.O. expanded at a time (or multiple, user's choice)

✅ **Clear Product Details**
- Product names from catalog
- Purity levels if available
- Ordered quantities

✅ **Visual Hierarchy**
- Items indented under P.O.
- Light blue background for sub-row
- Color-coded: blue names, green quantities

✅ **Bilingual Support**
- English: "Items to Receive:" / "units"
- Arabic: "السلع المطلوب استقبالها:" / "وحدات"

✅ **Non-Destructive**
- Expanding doesn't affect other P.O.s
- Receive Shipment button still works when row is expanded
- Button click doesn't toggle expansion

## Files Modified

- `frontend/src/App.tsx`
  - Added `expandedPOId` state variable (line ~879)
  - Modified P.O. table rendering in Receive Shipments (lines 4724-4794)
  - Added chevron icon with expand/collapse logic
  - Added items display sub-row with product details

## Testing

### Test 1: Expand/Collapse Toggle ✓
1. Open Receive Shipments screen
2. Click chevron next to a P.O.
3. Verify items appear below P.O. row
4. Click chevron again
5. Verify items disappear

### Test 2: Multiple P.O.s ✓
1. Expand P.O. #1 → items show
2. Expand P.O. #2 → both show items
3. Collapse P.O. #1 → only #2 shows items
4. Verify no data conflicts

### Test 3: Item Details ✓
1. Expand any P.O. with items
2. Verify product names correct (e.g., "Gold 100g")
3. Verify quantities match P.O. line items
4. Verify purity levels shown if available
5. Verify color coding applied (blue headers, green qty)

### Test 4: Receive Shipment Action ✓
1. Expand P.O.
2. Click "Receive Shipment" button
3. Verify intake modal opens for that P.O.
4. Verify items match expanded list
5. Complete intake workflow

### Test 5: Bilingual UI ✓
1. Switch language to Arabic
2. Expand P.O.
3. Verify "Items to Receive:" shows as "السلع المطلوب استقبالها:"
4. Verify "units" shows as "وحدات"
5. Switch back to English and verify

## API Integration

The fix properly integrates with the existing backend API:

**Endpoint:** `GET /api/purchase-orders`
**Returns:** Purchase orders with full line-item details including:
- `items[]` array with product_id, product_code, qty, received
- Status codes (APPROVED, PARTIAL_RECEIPT, RECEIVED, etc.)
- Vendor, weight, cost, and other P.O. metadata

**Field Mapping:**
- `po.items[].qty` → Ordered quantity to display
- `po.items[].product_id` → Link to product catalog
- `po.items[].received` → Future use for partial receipt UI

## Benefits

👁️ **Preview Before Intake**
- Know exactly what items are in the P.O.
- No surprises during barcode scanning
- Better organized workflow

📋 **Item-Level Visibility**
- See each line item separately
- Understand quantities per product
- Check purity/origin details

⚡ **Faster Receiving**
- Plan scanning order
- Verify expected items upfront
- Reduce re-scans and corrections

🌐 **Bilingual Support**
- Full English/Arabic interface
- Users comfortable in their language

## Next Steps (Optional)

- Add partial receipt status badge (show received/ordered qty)
- Display origin country in items list
- Add unit cost/weight info in expanded view
- Filter P.O.s by status (PARTIAL_RECEIPT, RECEIVED)
- Show received vs ordered progress indicator

## Notes

- Items only display if P.O. has items in response
- Empty P.O.s won't expand (no data to show)
- Product lookup uses product_id from API response
- Gracefully handles missing product metadata
- Compatible with partial receipt workflow (ReceivedQuantity tracking)
