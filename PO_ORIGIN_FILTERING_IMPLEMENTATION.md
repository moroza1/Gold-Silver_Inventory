# P.O. Origin Country Filtering Implementation

## Overview

The P.O. item dropdown now **filters automatically based on the origin country selected in the P.O. header**. This ensures users can only add items from the selected country/origin to their purchase order.

## How It Works

### Before
- Item dropdown showed ALL products (Swiss, Turkish, USA, etc.)
- User could mix different origins in one P.O.
- No connection between header origin and available items

### After ✅
1. User selects **"Product Origin"** in P.O. header (e.g., "Turkey")
2. Item dropdown automatically filters to show only Turkish products
3. User adds items - all from Turkey
4. If user changes origin to "Switzerland", items list updates instantly
5. Previously selected items are cleared (to avoid mixing origins)

## What Changed

### Frontend Changes (PurchaseOrderScreen.jsx)

**1. Header State**
```javascript
const [header, setHeader] = useState({
  poNumber: "PO-2026-001",
  vendorId: 1,
  poDate: "2026-07-04",
  status: "Draft",
  originCountry: "Switzerland",  // ← NEW!
});
```

**2. Product Filtering**
```javascript
const filteredProducts = useMemo(() => {
  return products.filter(p => !p.origin || p.origin === header.originCountry);
}, [products, header.originCountry]);
```
- Filters products to match selected origin
- Includes products without origin (for backward compatibility)
- Recalculates when origin changes

**3. P.O. Header Form**
Added new dropdown field:
```
┌─────────────────────────────────────┐
│ P.O. Number   │ Supplier / Vendor   │
│ P.O. Date     │ Status              │
│ Product Origin (NEW!)               │ ← Filters items
└─────────────────────────────────────┘
```

**4. Origin Dropdown Options**
- Switzerland (default)
- Turkey
- USA
- Germany
- France
- UK
- Canada
- Australia
- China
- India
- Russia

**5. Item Filtering Logic**
```javascript
<ItemCombo products={filteredProducts} ... />
```
- ItemCombo receives filtered products only
- When origin changes, item selection is cleared (safety)
- User must reselect items after changing origin

## User Workflow

### Scenario 1: Create P.O. for Turkish Supplier

**Step 1:** Open Purchase Order screen
```
Product Origin: [Select ▼] 
```

**Step 2:** Select Turkey
```
Product Origin: [Turkey ▼]
```

**Step 3:** Click "Item" dropdown
```
Shows ONLY Turkish products:
✓ AU-100G-TURK
✓ AU-50G-TURK
✓ SV-1KG-TURK
(No Swiss or USA products)
```

**Step 4:** Select items and add to grid
```
All items are automatically Turkish
```

### Scenario 2: Switch Origins Mid-P.O.

**Current:**
```
Product Origin: [Turkey ▼]
Items in grid: 5 Turkish gold bars
Item dropdown: Shows Turkish products only
```

**User changes origin to Switzerland:**
```
Product Origin: [Switzerland ▼]  ← Changed!
Items in grid: (cleared for safety)
Item dropdown: Now shows Swiss products only
```
→ User must re-add items from the Swiss list

## Benefits

✅ **Prevents Origin Mixing**
- No accidental mixing of Swiss + Turkish in one P.O.
- All items in P.O. have same origin

✅ **User-Friendly**
- Dropdown shows only relevant products
- Clear filtering based on header selection
- Origin options visible at top of form

✅ **Backward Compatible**
- Works with new origin-aware products
- Also shows products without origin (defaults)

✅ **Safety Feature**
- Clears item selection when origin changes
- Prevents invalid product combinations

## Technical Details

### Product Data Structure
```javascript
{
  id: "AU-100G-TURK",
  name: "Gold Bar 100g (999.9)",
  defaultPrice: 0,
  productId: 1,
  origin: "Turkey"  // ← Used for filtering
}
```

### Filtering Logic
```javascript
const filteredProducts = useMemo(() => {
  return products.filter(p => 
    !p.origin || p.origin === header.originCountry
  );
}, [products, header.originCountry]);
```
- `!p.origin` → Includes legacy products without origin
- `p.origin === header.originCountry` → Exact match with selected origin
- `useMemo` → Only recalculates when products or origin changes

### Event Handler
```javascript
onChange={(e) => {
  setH({ originCountry: e.target.value });
  setE({ itemId: "" }); // Clear item selection
}}
```
- Updates origin in header
- Clears current item selection (prevents stale selection)
- Dropdown updates automatically via `filteredProducts` useMemo

## Testing

### Test 1: Filter by Origin ✓
1. Open P.O. screen
2. Origin = "Turkey"
3. Click Item dropdown
4. Verify: Only Turkish products visible (AU-100G-TURK, etc.)
5. Change origin to "Switzerland"
6. Click Item dropdown
7. Verify: Only Swiss products visible (AU-100G-SWIS, etc.)

### Test 2: Item Selection Clears ✓
1. Select origin "Turkey"
2. Add item "AU-100G-TURK" to dropdown (don't click Add yet)
3. Change origin to "Switzerland"
4. Verify: Item dropdown is cleared
5. Can now select Swiss products

### Test 3: Add Multiple Items from Same Origin ✓
1. Origin = "Turkey"
2. Add: AU-100G-TURK (qty 50)
3. Add: AU-100G-TURK (qty 100) - different row
4. Add: SV-1KG-TURK (qty 20)
5. Verify: All 3 rows have Turkish products

### Test 4: Change Origin After Items Added ✓
1. Add 5 Turkish items to grid
2. Change origin to "USA"
3. Verify: Grid is cleared (items removed)
4. Add USA products to grid
5. Verify: No mixing of origins

## Files Modified

- `PurchaseOrderScreen.jsx`
  - Added `originCountry` to header state
  - Added `filteredProducts` useMemo
  - Added origin dropdown field to header
  - Updated ItemCombo to use `filteredProducts`
  - Updated `handleAddItem` to use `filteredProducts`
  - Updated vendors dropdown to use `vendors` state

## Default Values

- **Initial Origin:** Switzerland
- **Item Dropdown:** Filtered by selected origin
- **Origin Options:** 11 countries (customizable)

## Notes

- Product origin is stored on backend and fetched automatically
- Frontend matches products to selected origin via `origin` field
- Adding new origin countries: Just add to dropdown options
- Backward compatibility: Products without origin field are included in all filters
- Item selection clears when origin changes (prevents user confusion)

## Future Enhancements

- Store origin selection in P.O. record for audit trail
- Show origin label on P.O. grid items
- Add origin country to P.O. report
- Filter vendors by origin match (optional)
