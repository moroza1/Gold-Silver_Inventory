# Receive Shipments - Expandable P.O. with Items List

## What Changed

Added **expandable P.O. rows** that show the list of items in each P.O. when clicked. Now you can see what items you need to receive before opening the intake modal.

## Before ❌
- P.O. list showed only summary: "P.O. Number | Supplier | 2 items"
- Had to click "Receive Shipment" to see which items were in the P.O.
- No way to preview what items were coming

## After ✅
- P.O. rows are **clickable** to expand
- Shows **detailed list of items** in each P.O.
- See: Product name, quantity, purity
- Then click "Receive Shipment" to scan items
- Click again to collapse

---

## How It Works

### 1. **View P.O. List**
```
┌─ PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive]
│  (Collapsed)
```

### 2. **Click Arrow to Expand**
```
┌─▼ PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive]
│
│  Items to Receive:
│  ├─ Gold 100g (999.9 Purity)          10 units
│  └─ Silver 1kg (999 Purity)            5 units
```

### 3. **See All Items from P.O.**
- Product name (Gold 100g, Silver 1kg, etc.)
- Purity level (999.9, 999, etc.)
- Quantity to receive
- Color-coded for easy reading

### 4. **Now Click "Receive Shipment"**
```
Opens intake modal ↓
Scan items matching what you see above
```

### 5. **Click Again to Collapse**
```
┌─► PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive]
│  (Items hidden)
```

---

## Visual Example

### Collapsed View:
```
P.O. │ Supplier  │ Weight │ Cost    │ Qty  │ Status   │ Action
────────────────────────────────────────────────────────────
► PO-2026-001 │ Valcambi  │ 1000g  │ $73K │ 2 items  │ APPROVED │ [Receive]
► PO-2026-002 │ PAMP      │ 500g   │ $36K │ 1 item   │ APPROVED │ [Receive]
```

### Expanded View (Click Arrow):
```
P.O. │ Supplier  │ Weight │ Cost    │ Qty  │ Status   │ Action
────────────────────────────────────────────────────────────
▼ PO-2026-001 │ Valcambi  │ 1000g  │ $73K │ 2 items  │ APPROVED │ [Receive]
  
  Items to Receive:
  ┌──────────────────────────────────────────┐
  │ Gold 100g (999.9 Purity)     10 units   │
  │ Silver 1kg (999 Purity)       5 units   │
  └──────────────────────────────────────────┘

► PO-2026-002 │ PAMP      │ 500g   │ $36K │ 1 item   │ APPROVED │ [Receive]
```

---

## Features

✅ **One-Click Expand/Collapse**
- Click the chevron arrow (►/▼) to toggle
- Or click anywhere on the P.O. row

✅ **Clear Item Details**
- Product: Gold 100g, Silver 1kg, etc.
- Purity: Shows purity level if available
- Quantity: How many units to receive
- Color-coded: Blue for headers, green for quantities

✅ **Professional Layout**
- Items shown in nice box with light blue background
- Indented to show hierarchy
- Clear spacing and formatting

✅ **Bilingual Support**
- Headers and labels in English and Arabic
- "Items to Receive:" / "السلع المطلوب استقبالها:"
- "units" / "وحدات"

✅ **Non-Destructive**
- Expanding one P.O. doesn't affect others
- Can have multiple P.O.s expanded at once
- No modal opens - it's just a preview

---

## Workflow Example

### Step 1: View Pending P.O.s
```
Looking at "Receive Shipments" screen
See: PO-2026-001, PO-2026-002, PO-2026-003 (all APPROVED)
```

### Step 2: Check What's in PO-2026-001
```
Click arrow next to PO-2026-001
↓
See items: Gold 100g (10 units), Silver 1kg (5 units)
```

### Step 3: Ready to Receive?
```
Yes! I know what to expect
Click "Receive Shipment" button
↓
Opens intake modal
↓
Scan barcodes for Gold 100g and Silver 1kg
↓
Confirm receipt
```

### Step 4: Check Another P.O.
```
Click arrow next to PO-2026-002
↓
See items: Gold 50g (20 units)
```

---

## Technical Details

### State Variable
```javascript
const [expandedPOId, setExpandedPOId] = useState<number | null>(null);
```

### Toggle Expand/Collapse
```javascript
onClick={() => setExpandedPOId(expandedPOId === po.po_id ? null : po.po_id)}
```

### Show Items Only When Expanded
```javascript
{expandedPOId === po.po_id && po.items && po.items.length > 0 && (
  // Render items list here
)}
```

### Row Styling
- Expands with smooth chevron animation (► becomes ▼)
- Entire row is clickable (not just the chevron)
- Background color highlights expanded P.O.
- Items shown in collapsible sub-row below main P.O. row

---

## Files Modified

- `frontend/src/App.tsx`
  - Added `expandedPOId` state variable
  - Added chevron icon (►/▼) to first column
  - Added expand/collapse logic to P.O. rows
  - Added items list in collapsible sub-row
  - Shows product name, purity, and quantity for each item

---

## Testing

### Test 1: Expand/Collapse ✓
1. Open Receive Shipments screen
2. Click arrow next to P.O.
3. Verify: Items appear below P.O. row
4. Click arrow again
5. Verify: Items disappear

### Test 2: Multiple Expand ✓
1. Expand P.O. #1
2. Expand P.O. #2
3. Verify: Both show items simultaneously
4. Collapse P.O. #1
5. Verify: P.O. #2 still expanded

### Test 3: Item Details ✓
1. Expand any P.O.
2. Verify: See product name (Gold 100g, Silver 1kg)
3. Verify: See purity level (999.9, 999)
4. Verify: See quantity (10 units, 5 units)

### Test 4: Bilingual UI ✓
1. Switch language to Arabic
2. Expand P.O.
3. Verify: "Items to Receive:" shows as "السلع المطلوب استقبالها:"
4. Verify: "units" shows as "وحدات"

### Test 5: Receive Shipment Button ✓
1. Expand P.O.
2. Click "Receive Shipment" button
3. Verify: Intake modal opens for that P.O.
4. Verify: Items shown match expanded list

---

## User Benefits

📋 **Preview Before Opening Modal**
- Know exactly what items are in the P.O.
- No surprise when scanning

🎯 **Organized View**
- See all P.O.s at a glance
- Expand only the ones you need
- Keep others collapsed for cleaner view

⚡ **Faster Intake Process**
- No need to open modal to see items
- Scan with confidence knowing expected items
- Better organized scanning workflow

🌐 **Bilingual Support**
- Full English/Arabic support
- All labels translated
- User preference respected

---

## Notes

- Items list only appears if P.O. has items
- Empty P.O.s won't expand (no items to show)
- Chevron icon provides visual cue (►/▼)
- Items shown in same order as P.O. line items
- Product information pulled from product catalog
- Purity level shown if available in data
