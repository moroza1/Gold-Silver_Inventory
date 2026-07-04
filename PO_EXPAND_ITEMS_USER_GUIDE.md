# P.O. Item Expansion - User Guide

## What's New

The **Receive Shipments** screen now lets you expand P.O. rows to see all items in the shipment **before** you open the intake modal. This helps you:
- Preview what's coming
- Plan your scanning workflow
- Know exactly which products to expect

## How to Use

### Step 1: Open "Receive Shipments"
Navigate to **Receive Shipments (Vault Intake)** from the left menu.

You'll see a list of approved P.O.s waiting to be received.

### Step 2: Click the Arrow to Expand

Each P.O. row now has a **chevron arrow** (►) at the start:

```
► PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive Shipment]
```

**Click the arrow** to see the items in that P.O.

### Step 3: View Items

The P.O. row expands to show all line items:

```
▼ PO-2026-001 │ Valcambi │ 1000g │ $73,200 │ 2 items │ APPROVED │ [Receive Shipment]

  Items to Receive:
  
  ┌──────────────────────────────────────┐
  │ Gold 100g (999.9 Purity)    10 units │
  │ Silver 1kg (999 Purity)      5 units │
  └──────────────────────────────────────┘
```

For each item, you'll see:
- **Product Name** - e.g., "Gold 100g", "Silver 1kg"
- **Purity** - if available, e.g., "999.9", "999"
- **Quantity** - how many units to receive, e.g., "10 units"

### Step 4: Review & Plan

Use this information to:
- ✓ Verify you're receiving the right products
- ✓ Know the quantities before scanning
- ✓ Plan your scanning order
- ✓ Check purity levels match your records

### Step 5: Click "Receive Shipment"

When you're ready to scan items, click the blue **[Receive Shipment]** button.

The intake modal opens and you can start scanning barcodes for the items shown above.

### Step 6: Collapse (Optional)

Click the arrow again (▼) to collapse the items list and see other P.O.s more clearly.

---

## Examples

### Example 1: Single P.O. Expanded

```
PURCHASE ORDER LIST

▼ PO-2026-001         │ Valcambi   │ 1000g  │ $73,200 │ 2 items │ APPROVED │ [Receive]
  
  Items to Receive:
  ┌────────────────────────────────────────┐
  │ Gold 100g (999.9 Purity)     10 units  │
  │ Silver 1kg (999 Purity)       5 units  │
  └────────────────────────────────────────┘

► PO-2026-002         │ PAMP       │ 500g   │ $36,000 │ 1 item  │ APPROVED │ [Receive]

► PO-2026-003         │ Heraeus    │ 250g   │ $18,100 │ 2 items │ APPROVED │ [Receive]
```

### Example 2: Multiple P.O.s Expanded

```
PURCHASE ORDER LIST

▼ PO-2026-001         │ Valcambi   │ 1000g  │ $73,200 │ 2 items │ APPROVED │ [Receive]
  
  Items to Receive:
  ┌────────────────────────────────────────┐
  │ Gold 100g (999.9 Purity)     10 units  │
  │ Silver 1kg (999 Purity)       5 units  │
  └────────────────────────────────────────┘

▼ PO-2026-002         │ PAMP       │ 500g   │ $36,000 │ 1 item  │ APPROVED │ [Receive]
  
  Items to Receive:
  ┌────────────────────────────────────────┐
  │ Gold 50g (999.9 Purity)      20 units  │
  └────────────────────────────────────────┘

► PO-2026-003         │ Heraeus    │ 250g   │ $18,100 │ 2 items │ APPROVED │ [Receive]
```

### Example 3: Viewing a P.O. with Multiple Items

When you expand a P.O. with many items:

```
▼ PO-2026-001         │ Valcambi   │ 1000g  │ $73,200 │ 5 items │ APPROVED │ [Receive]
  
  Items to Receive:
  ┌──────────────────────────────────────────┐
  │ Gold 100g (999.9 Purity)      10 units   │
  │ Gold 50g (999.9 Purity)       20 units   │
  │ Silver 1kg (999 Purity)        5 units   │
  │ Silver 500g (999 Purity)      10 units   │
  │ Platinum 10g (950 Purity)      5 units   │
  └──────────────────────────────────────────┘
```

---

## Workflow: Complete Intake Process

### Before (Without Item Expansion)
```
1. See P.O. list
2. Click "Receive Shipment"
3. Modal opens → SURPRISE! What items am I receiving?
4. Look back at P.O. to find items
5. Start scanning (confused)
```

### After (With Item Expansion) ✓
```
1. See P.O. list
2. Click chevron to expand → See ALL items
3. Review quantities, purity, products
4. Feel confident → Click "Receive Shipment"
5. Modal opens → Already know what to scan
6. Scan barcodes (prepared!)
7. Confirm receipt
```

---

## Tips & Tricks

### Tip 1: Multiple P.O.s at Once
- You can expand multiple P.O.s simultaneously
- Click one chevron, then another without collapsing the first
- Useful for comparing multiple shipments

### Tip 2: Check Purity Before Scanning
- Purity shown in the items list: "Gold 100g (999.9 Purity)"
- Verify this matches your barcode scanning expectations
- Helps catch wrong items before receipt

### Tip 3: Plan Your Scanning Order
- If 10 units of Gold 100g and 5 of Silver 1kg...
- You might scan all Gold first, then Silver
- The expanded list helps you organize

### Tip 4: Quantity Verification
- Compare what's shown (ordered qty) with what arrives
- If you receive fewer items → P.O. stays PARTIAL_RECEIPT
- You'll receive remaining items later

---

## Languages

The feature supports English and Arabic. The interface will automatically match your language setting.

**English:**
- "Items to Receive:" header
- "units" quantity label

**العربية:**
- "السلع المطلوب استقبالها:" header
- "وحدات" quantity label

---

## FAQ

**Q: Can I expand multiple P.O.s?**
A: Yes! Click different chevrons to expand multiple P.O.s at the same time.

**Q: What if a P.O. has no items?**
A: The chevron won't expand (no items to show). This is rare and indicates a data issue.

**Q: Does expanding affect the Receive Shipment button?**
A: No. You can click "Receive Shipment" whether the row is expanded or collapsed.

**Q: Will this show partial receipts?**
A: Currently shows ordered quantities. Future versions will show received vs. ordered.

**Q: Can I print the items list?**
A: The items display is on-screen only. You can take a screenshot if needed.

**Q: What if the product name is cut off?**
A: Hover your mouse over the product name to see the full text (tooltip).

---

## What You'll See

### Product Details Column
- **Product Name**: "Gold 100g", "Silver 1kg", etc.
- **Purity**: "(999.9 Purity)" if available
- **Quantity**: "10 units" in green (right side)

### Visual Design
- **Blue chevron icon** (►/▼) shows expand/collapse
- **Light blue background** for items row
- **Blue text** for product names
- **Green text** for quantities
- **Clean layout** with proper spacing

### Colors
- 🔵 **Blue** = Product details, headers, interactive elements
- 🟢 **Green** = Quantities (what you're receiving)
- ⚫ **Gray** = Purity and secondary info

---

## Troubleshooting

**Arrow appears but items don't show?**
- P.O. might have no items in the system
- Check if P.O. items are properly created
- Try refreshing the screen

**Wrong product names showing?**
- Products must exist in the system catalog
- If not in catalog, you'll see "Product #123" instead
- Contact admin to add missing products

**Purity not showing?**
- Purity is optional and depends on product data
- Not all products have purity assigned
- This is normal behavior

---

## Related Features

- **Partial P.O. Receipt**: If you receive fewer items than ordered, P.O. stays open
- **Scanned Items Grid**: See items you've added during intake (inside modal)
- **Product Origin**: Items show origin (Swiss, Turkish, etc.) if configured
- **P.O. History**: All receipts tracked for audit

---

## Contact

For questions or issues with this feature:
- Check the system documentation
- Contact your system administrator
- Report bugs to the support team

Happy receiving! 📦✓
