# Product Origin Country Implementation

## Overview

Added **origin country support** to the product catalog system so users can differentiate between products from different countries (e.g., Swiss gold vs Turkish gold) and have proper product codes like **AU-100G-TURK** or **AU-100G-SWIS**.

## What Changed

### Backend Changes

**1. CreateProductRequestDto** (PMIMSControllers.cs)
```csharp
public class CreateProductRequestDto
{
    public string Label { get; set; }           // 100g
    public string MetalName { get; set; }       // Gold, Silver
    public decimal WeightGrams { get; set; }    // 100
    public string OriginCountry { get; set; }   // Switzerland, Turkey, USA (NEW!)
}
```

**2. CreateDenominationProductAsync** (InventoryRepository.cs)
- Updated method signature to accept optional `originCountry` parameter
- Builds product code with origin abbreviation: `AU-100G-TURK` (not `AU-100G-GEN`)
- Added `GetOriginAbbreviation()` helper that converts country names to 4-letter codes:
  - Turkey → TURK
  - Switzerland → SWIS
  - USA → USA
  - UK → UK
  - (etc. - 15 mappings)

**3. CreateProduct Endpoint** (PMIMSControllers.cs)
- Now passes `req.OriginCountry` to the repository method
- Response includes `origin_country` field

### Frontend Changes

**1. State Variables** (App.tsx)
```javascript
const [newDenomOrigin, setNewDenomOrigin] = useState('Switzerland');
const [editDenomOrigin, setEditDenomOrigin] = useState('Switzerland');
```

**2. Denominations Table**
- **New Column**: "Origin Country" displayed between "Weight" and "Actions"
- Shows origin for each product (defaults to "Switzerland" if not set)

**3. Add New Denomination Form**
- **New Field**: "Origin Country" input field
- Defaults to "Switzerland"
- Example: user types "Turkey" to create Turkish gold

**4. Edit Product**
- Users can edit origin country when modifying a product
- Changes persist to backend

**5. Product Listing**
- `fetchProducts()` now includes `origin_country` and `product_code` in denomsList
- P.O. dropdown will show proper product codes like "AU-100G-TURK"

## How It Works

### Creating a Product with Origin Country

**User Action:**
1. Settings → Denominations
2. Fill in form:
   - Label: "100g"
   - Metal Type: "Gold"
   - Weight: "100"
   - **Origin Country: "Turkey"** ← NEW!
3. Click "Add Denomination"

**What Happens:**
- Backend receives: `{ label: "100g", metalName: "Gold", weightGrams: 100, originCountry: "Turkey" }`
- Creates denomination: "100g"
- Generates product code: **AU-100G-TURK**
- Stores product with `OriginCountry = "Turkey"`

**Result:**
- P.O. dropdown shows: "AU-100G-TURK — Gold Bar 100g (999.9)"
- Dashboard shows distinct Swiss and Turkish gold products

### Product Code Format

```
[METAL]-[WEIGHT]G-[ORIGIN]

AU-100G-SWIS    (Gold, 100g, Swiss)
AU-100G-TURK    (Gold, 100g, Turkish)
SV-1KG-USA      (Silver, 1kg, USA origin)
```

## Testing Checklist

### Test 1: Create Two Gold Bars with Different Origins ✓

**Steps:**
1. Open Settings → Denominations
2. Create first product:
   - Label: "100g"
   - Metal: "Gold"
   - Weight: "100"
   - Origin: "Switzerland"
   - Click "Add"
3. Create second product:
   - Label: "100g"
   - Metal: "Gold"
   - Weight: "100"
   - Origin: "Turkey"
   - Click "Add"

**Expected Result:**
- Denominations table shows 2 rows:
  | Label | Metal | Weight | Origin Country | Actions |
  |-------|-------|--------|-----------------|---------|
  | 100g  | Gold  | 100g   | Switzerland     | Edit/Delete |
  | 100g  | Gold  | 100g   | Turkey          | Edit/Delete |

- Product codes generated:
  - AU-100G-SWIS
  - AU-100G-TURK

### Test 2: Products Appear in P.O. Dropdown ✓

**Steps:**
1. Navigate to Procurement → Purchase Orders
2. Open "Item" dropdown in P.O. screen
3. Look for both products

**Expected Result:**
```
AU-100G-SWIS — Gold Bar 100g (999.9)
AU-100G-TURK — Gold Bar 100g (999.9)
```
Both appear as separate options with different product codes.

### Test 3: Edit Product Origin ✓

**Steps:**
1. Settings → Denominations
2. Click Edit on AU-100G-SWIS row
3. Change Origin Country to "Canada"
4. Click ✓ Save

**Expected Result:**
- Product code updates to AU-100G-CANA
- Row refreshes with new origin

### Test 4: Database Verification ✓

**SQL Check:**
```sql
SELECT 
  product_code, 
  metal_name, 
  denomination_label, 
  origin_country
FROM MetalProducts
WHERE product_code LIKE '%TURK%' OR product_code LIKE '%SWIS%';
```

**Expected Output:**
```
product_code    | metal_name | denomination_label | origin_country
----------------|------------|-------------------|----------------
AU-100G-TURK    | Gold       | 100g               | Turkey
AU-100G-SWIS    | Gold       | 100g               | Switzerland
```

## Files Modified

**Backend:**
- `backend/PMIMS.WebAPI/Controllers/PMIMSControllers.cs`
  - Updated `CreateProductRequestDto`
  - Updated `CreateProduct` endpoint
- `backend/PMIMS.Infrastructure/InventoryRepository.cs`
  - Updated `CreateDenominationProductAsync` method signature
  - Added `GetOriginAbbreviation()` helper
  - Updated product code generation logic
- `backend/PMIMS.Application/Interfaces.cs`
  - Updated `CreateDenominationProductAsync` interface

**Frontend:**
- `frontend/src/App.tsx`
  - Added `newDenomOrigin` and `editDenomOrigin` state
  - Updated `fetchProducts()` to include origin data
  - Added origin country column to Denominations table
  - Added origin country field to "Add New Denomination" form
  - Updated edit form to handle origin country

## Key Features

✅ **Proper Product Differentiation**
- Swiss gold and Turkish gold are now distinct products
- Each has its own product code and database record

✅ **User-Friendly UI**
- Origin Country field in all relevant forms
- Table display shows origin clearly
- Defaults to "Switzerland" for backward compatibility

✅ **Automatic Code Generation**
- Product codes automatically include origin abbreviation
- No manual code entry needed

✅ **Multi-Language Support**
- "Origin Country" label translated to Arabic
- Form placeholders in both English and Arabic

## Backward Compatibility

- Existing products without origin country default to "Switzerland"
- Old product codes (e.g., "AU-100G-GEN") continue to work
- New products MUST specify origin to use new naming scheme

## API Response Format

When fetching products, backend returns:

```json
[
  {
    "product_id": 1,
    "product_code": "AU-100G-SWIS",
    "metal_name": "Gold",
    "denomination_label": "100g",
    "purity_value": 999.9,
    "origin_country": "Switzerland",
    "is_active": true
  },
  {
    "product_id": 2,
    "product_code": "AU-100G-TURK",
    "metal_name": "Gold",
    "denomination_label": "100g",
    "purity_value": 999.9,
    "origin_country": "Turkey",
    "is_active": true
  }
]
```

## Notes

- Origin abbreviations are case-insensitive (handles "TURKEY", "Turkey", "turkey")
- Unknown countries default to first 4 letters of country name (or "UNK" if blank)
- Product codes are unique per: Metal + Weight + Origin combination
- Frontend validates origin country input (accepts any text, no specific list required)

## Run the Application

```bash
# Backend
cd backend/PMIMS.WebAPI
dotnet run

# Frontend
cd frontend
npm run dev
```

Then test creating products with different origins in Settings → Denominations.
