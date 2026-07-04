# Purchase Order Screen - Backend Integration Guide

## Overview

The **PurchaseOrderScreen.jsx** now fetches real product and vendor data from your PMIMS backend instead of using hardcoded demo data. This ensures the product IDs (like "AU-100G-TURK") reflect your actual product catalog.

## How It Works

### 1. **Product Catalog Loading**

When the screen loads, it:
1. Calls `GET /api/catalog/products` to fetch all active products
2. Maps backend product data to component format:
   ```javascript
   {
     id: "AU-100G-TURK",           // Product code (displayed in grid)
     name: "Gold Bar 100g (999.9)", // Formatted product name
     productId: 5,                  // Internal product ID (for API)
     defaultPrice: 0                // User enters unit price on P.O.
   }
   ```
3. Falls back to demo data if backend is unavailable

### 2. **Vendor List Loading**

Similarly:
1. Calls `GET /api/master-data/vendors` to fetch vendors
2. Maps vendor data:
   ```javascript
   {
     id: 2,                           // Vendor ID
     name: "Nadir Refinery (Turkey)"  // Vendor name + origin
   }
   ```

### 3. **Error Handling**

If the backend is unavailable:
- Shows loading spinner briefly
- Falls back to demo data automatically
- Console warnings show which data is using fallback

## Setup Steps

### Step 1: Verify Backend URL

Edit the API_BASE in PurchaseOrderScreen.jsx:

```javascript
const API_BASE = "http://localhost:8080/api";  // ← Change if needed
```

**If your backend is running elsewhere:**
- Local dev: `http://localhost:8080/api`
- Remote server: `https://your-server.com/api`

### Step 2: Ensure Endpoints Exist

Your backend needs these endpoints:

| Endpoint | Method | Returns | Example Response |
|----------|--------|---------|------------------|
| `/api/catalog/products` | GET | Array of products | See below |
| `/api/master-data/vendors` | GET | Array of vendors | See below |

**Product Response Format:**
```json
[
  {
    "product_id": 1,
    "product_code": "AU-100G-TURK",
    "metal_type": "Gold",
    "denomination_label": "100g",
    "purity_value": "999.9",
    "origin_country": "Turkey",
    "is_active": true
  }
]
```

**Vendor Response Format:**
```json
[
  {
    "vendor_id": 2,
    "vendor_name": "Nadir Gold Refinery",
    "country_of_origin": "Turkey",
    "is_sharia_compliant": true
  }
]
```

### Step 3: Check Your Backend Controllers

The endpoints above should already exist in your PMIMS backend:

**Backend Location**: `backend/PMIMS.WebAPI/Controllers/PMIMSControllers.cs`

Look for:
- `GetProductsAsync()` → returns `List<MetalProduct>`
- `GetVendorsAsync()` → returns `List<Vendor>`

If they don't exist, add them:

```csharp
[HttpGet("catalog/products")]
[Authorize(Policy = "purchase_orders.read")]
public async Task<IActionResult> GetProducts()
{
    var products = await _repository.GetProductsAsync();
    return Ok(products.Select(p => new {
        product_id = p.ProductId,
        product_code = p.ProductCode,
        metal_type = p.MetalType?.MetalName,
        denomination_label = p.Denomination?.Label,
        purity_value = p.Purity?.PurityValue,
        origin_country = p.OriginCountry,
        is_active = p.IsActive
    }));
}

[HttpGet("master-data/vendors")]
[Authorize(Policy = "master_data.read")]
public async Task<IActionResult> GetVendors()
{
    var vendors = await _repository.GetVendorsAsync();
    return Ok(vendors.Select(v => new {
        vendor_id = v.VendorId,
        vendor_name = v.VendorName,
        country_of_origin = v.CountryOfOrigin,
        is_sharia_compliant = v.IsShariaCompliant
    }));
}
```

### Step 4: Test the Integration

1. Start the backend:
   ```bash
   cd backend/PMIMS.WebAPI
   dotnet run
   ```

2. Start the frontend (separate terminal):
   ```bash
   cd frontend
   npm run dev
   ```

3. Open PurchaseOrderScreen:
   - Should see loading spinner briefly
   - Product dropdown should show real product codes (e.g., "AU-100G-TURK")
   - Vendor dropdown should show real vendor names

## Troubleshooting

### Problem: Still Seeing Demo Data

**Check 1**: Backend is running
```bash
curl http://localhost:8080/api/catalog/products
```
Should return JSON array of products.

**Check 2**: Check browser console for errors
- Open DevTools (F12)
- Look for CORS errors or 404s
- If you see 404, endpoint doesn't exist — add it to controller

**Check 3**: Verify API_BASE URL
```javascript
const API_BASE = "http://localhost:8080/api";
```

### Problem: CORS Error

If you see: `Access to XMLHttpRequest blocked by CORS policy`

Add CORS to backend Program.cs:
```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader());
});

app.UseCors("AllowFrontend");
```

### Problem: Empty Product List

1. Check backend database has products:
   ```bash
   SELECT COUNT(*) FROM MetalProducts WHERE IsActive = 1;
   ```

2. Check endpoint returns data:
   ```bash
   curl http://localhost:8080/api/catalog/products -H "Authorization: Bearer YOUR_TOKEN"
   ```

3. If using auth, ensure your token is valid and includes `purchase_orders.read` permission

## How Product IDs Flow to Backend

When user creates P.O., the grid sends:

```javascript
[
  {
    "product_id": 1,           // ← From product.productId
    "ordered_quantity": 100,
    "unit_cost": 7320
  },
  {
    "product_id": 5,
    "ordered_quantity": 50,
    "unit_cost": 2800
  }
]
```

Backend receives this and creates POItem rows with the correct ProductId.

## Files Modified

- `frontend/src/PurchaseOrderScreen.jsx`
  - Added `useEffect` to fetch products/vendors from `/api/catalog/products` and `/api/master-data/vendors`
  - Added loading state
  - Changed hardcoded arrays to fetched data

## Fallback Behavior

If backend is down:
1. Component shows "Loading..." spinner
2. After timeout, falls back to demo data
3. Continues working with demo products
4. User can still create P.O.s (using demo data)

This ensures the app doesn't crash if your backend is temporarily unavailable.

## Next Steps

1. Verify `/api/catalog/products` and `/api/master-data/vendors` exist and return correct data
2. Update `API_BASE` URL if your backend isn't on localhost:8080
3. Test the integration by creating a P.O. and checking that product codes match your real catalog
