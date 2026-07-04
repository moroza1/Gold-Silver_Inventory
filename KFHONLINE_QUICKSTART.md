# KFHOnline - Quick Start Guide

Get KFHOnline up and running in 5 minutes!

## What is KFHOnline?

A simple web-based gold trading portal for Kuwait Finance House (KFH) customers to:
- Buy gold at live prices
- Sell gold with serial number tracking
- Request delivery to their address
- View transaction history

## Files Overview

| File | Purpose |
|------|---------|
| `frontend/kfhonline.html` | Complete customer portal (self-contained HTML/CSS/JS) |
| `backend/PMIMS.Domain/CustomerEntities.cs` | Database entities for transactions & gold details |
| `backend/PMIMS.WebAPI/Controllers/KFHOnlineControllers.cs` | REST API endpoints |
| `KFHONLINE_README.md` | Full documentation |
| `KFHONLINE_INTEGRATION_GUIDE.md` | Step-by-step backend setup |

## Quick Start (No Backend Required)

### 1. Open the Portal

Simply open the HTML file in your web browser:

**Windows:**
```
Double-click: frontend/kfhonline.html
```

**macOS/Linux:**
```bash
open frontend/kfhonline.html
# Or
firefox frontend/kfhonline.html
```

**Or serve locally:**
```bash
cd frontend
python -m http.server 8000
# Visit http://localhost:8000/kfhonline.html
```

### 2. Test the Dashboard

The portal opens with a **Dashboard** showing:
- Live gold prices: **$65.00/gram**
- Total holdings: **500g**
- Pending orders: **2**
- Account value: **~$32,500**

### 3. Try Buy Gold

1. Click the **💳 Buy Gold** tab
2. Fill in the form:
   ```
   Customer ID: CUST-TEST-001
   Full Name: Ahmed Al-Sabah
   Email: ahmed@example.com
   Weight: 100 grams
   Purity: 99.99%
   ```
3. Click **✓ Confirm Buy Order**
4. See the success message with real-time calculation:
   ```
   Amount: $6,500.00 (100g × $65/g)
   ```

### 4. Try Sell Gold

1. Click the **🔄 Sell Gold** tab
2. Fill in customer details
3. Enter weight: `50` grams
4. **Add Serial Numbers:**
   - Type: `AUG-2024-001-A`
   - Click **Add**
   - Type: `AUG-2024-002-B`
   - Click **Add**
5. Click **✓ Confirm Sell Order**
6. You should receive: `$3,250.00` (50g × $65/g)

### 5. Try Request Delivery

1. Click the **🚚 Delivery** tab
2. Fill in the form:
   ```
   Transaction ID: 1
   Customer ID: CUST-TEST-001
   Delivery Address: P.O. Box 123, Kuwait City
   City: Kuwait City
   Country: Kuwait
   Phone: +965 123 4567
   Shipping Fee: $50.00
   ```
3. Click **✓ Request Delivery**
4. Get confirmation: "Delivery request submitted. We will process your request within 24 hours."

### 6. Check Transaction History

1. Click the **📋 History** tab
2. Enter Customer ID: `CUST-TEST-001`
3. Click **🔍 Load History**
4. See all transactions with gold details and serial numbers

## Portal Features Explained

### Real-Time Price Updates
- Gold price updates every 30 seconds
- Calculations done instantly in browser
- No page refresh needed

### Buy Gold Flow
```
Customer fills form
    ↓
Real-time amount calculated
    ↓
Success confirmation sent
    ↓
Gold bars allocated from PMIMS vault
    ↓
Serial numbers tracked
```

### Sell Gold Flow
```
Customer enters serial numbers
    ↓
Numbers added to list
    ↓
Sale price calculated
    ↓
Can remove individual serials if needed
    ↓
Submit for approval
```

### Delivery Request Flow
```
Customer provides address
    ↓
Shipping fee calculated
    ↓
Request submitted
    ↓
PMIMS picks gold from vault
    ↓
Insurance & shipping arranged
    ↓
Customer gets tracking reference
```

## Key UI Elements

### Dashboard Tab
- Shows KPI cards (Price, Holdings, Orders, Value)
- Recent transactions list
- Quick overview of account health

### Buy Gold Tab
- Live price display
- Customer info form
- Weight calculator
- Real-time amount calculation
- Success/error messages

### Sell Gold Tab
- Serial number manager (add/remove)
- Denomination selector
- Purity choice (99.99%, 99.9%, 95%)
- Real-time payout calculation
- Validation before submission

### Delivery Tab
- Transaction ID lookup
- Address form
- Phone/contact info
- Shipping fee configuration
- Special instructions notes

### History Tab
- Customer ID search
- Complete transaction list
- Gold details with serial numbers
- Status badges (PENDING/COMPLETED/FAILED)
- PMIMS vault location links

## Mobile Support

The portal is fully responsive:
- **Desktop:** Full layout with side-by-side columns
- **Tablet:** Single column, touch-optimized
- **Mobile:** Stacked form, large buttons for touch

Test on mobile by:
```
Browser DevTools → F12 → Toggle Device Toolbar
```

## Color Scheme

The portal uses a **gold/luxury theme**:
- **Gold**: `#d4af37` (main accent, buttons)
- **Light Gold**: `#f0e68c` (highlights)
- **Dark Navy**: `#1e1e2e` (background)
- **White**: Forms and content areas

Perfect for a luxury finance brand like KFH!

## API Endpoints (When Backend is Running)

Once you start the PMIMS backend on port 8080, KFHOnline will call these real endpoints:

### Buy Gold
```
POST /api/kfhonline/transactions/buy
```

### Sell Gold
```
POST /api/kfhonline/transactions/sell
```

### Request Delivery
```
POST /api/kfhonline/delivery/request
```

### Get Transaction History
```
GET /api/kfhonline/transactions/{customerId}
```

### Get Gold Price
```
GET /api/kfhonline/prices/gold
```

Full API reference: See `KFHONLINE_README.md`

## Connecting to Live Backend

### Step 1: Start PMIMS Backend
```bash
cd backend/PMIMS.WebAPI
dotnet run
# Server starts on http://localhost:8080
```

### Step 2: Verify Backend is Running
```bash
curl http://localhost:8080/api/kfhonline/prices/gold
# Should return: {"metal":"GOLD","pricePerGram":65.00,...}
```

### Step 3: Open KFHOnline Portal
```bash
open frontend/kfhonline.html
```

### Step 4: Submit Real Transaction
- Fill in form with real customer data
- Click submit
- Transaction goes to backend
- Real data saved to database
- Gold bars allocated from PMIMS vault
- Serial numbers tracked

## Testing Scenarios

### Scenario 1: New Customer - First Purchase
1. Unique Customer ID: `CUST-NEW-2024-001`
2. New email address
3. Buy 250g of gold
4. Check transaction history
5. Request delivery to home address

**Expected Result:** Transaction appears in history with PMIMS vault location

### Scenario 2: Portfolio Liquidation
1. Existing customer ID
2. Add 5 serial numbers (gold bars to sell)
3. Sell at current market price
4. Verify payout amount
5. Check delivery status

**Expected Result:** Transaction logged, payment quote provided

### Scenario 3: Bulk Buy for Investment
1. Customer ID with existing holdings
2. Buy 1000g of gold (large order)
3. Multiple bars allocated from vault
4. View allocated serial numbers
5. Request insured delivery

**Expected Result:** Multiple gold details linked to transaction

### Scenario 4: Price Tracking
1. Open portal
2. Note current gold price
3. Wait 30 seconds
4. Observe price auto-update
5. See calculations update in real-time

**Expected Result:** Price refreshes automatically

## Troubleshooting

### Portal doesn't load
- Check browser console (F12)
- Ensure JavaScript is enabled
- Try a different browser (Chrome, Firefox, Safari)

### Gold price shows $0
- Backend not running
- Or rate feed service unavailable
- Check console for error messages

### Buy/Sell buttons don't work
- JavaScript might be disabled
- Or form validation failed
- Check filled fields are correct format

### Backend connection errors
- Verify backend running: `curl http://localhost:8080`
- Check CORS is enabled in Program.cs
- Check API endpoint URLs in kfhonline.html

## Next Steps

### For Demos:
1. Open `kfhonline.html` in browser
2. Test each feature
3. Show real-time price updates
4. Demonstrate transaction logging
5. Show PMIMS vault integration

### For Development:
1. Follow steps in `KFHONLINE_INTEGRATION_GUIDE.md`
2. Complete backend database setup
3. Implement repository methods
4. Test with live API calls
5. Deploy to production

### For Production:
1. Set up SQL Server database
2. Configure SSL/TLS certificates
3. Implement JWT authentication
4. Add rate limiting & DDoS protection
5. Set up email notifications
6. Configure shipping integrations
7. Deploy to web servers
8. Set up monitoring & alerts

## Support Resources

- **Full Documentation:** `KFHONLINE_README.md`
- **Integration Guide:** `KFHONLINE_INTEGRATION_GUIDE.md`
- **PMIMS Docs:** `AGENTS.md`, `ARCHITECTURE.md`
- **Code:** Backend in `PMIMS.WebAPI/Controllers/KFHOnlineControllers.cs`

## Summary

✅ **What You Get:**
- Complete customer portal (ready to use)
- REST API endpoints (ready to integrate)
- Database entities (ready to deploy)
- Full documentation (ready to share)
- Real-time pricing (automatic updates)
- Transaction logging (full audit trail)
- Serial number tracking (complete integration with PMIMS)

✅ **Time to Deploy:**
- **Demo/Testing:** 5 minutes (open HTML file)
- **Development:** 30-45 minutes (follow integration guide)
- **Production:** 2-3 days (security, deployment, testing)

---

**Created:** July 4, 2026
**Version:** 1.0
**Status:** Ready for Testing ✓
