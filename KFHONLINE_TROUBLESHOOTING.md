# KFHOnline - Troubleshooting Guide

## Error: "✗ Error: Unexpected end of JSON input"

### What happened?
The portal tried to connect to the PMIMS backend API but couldn't parse the response as JSON. This usually means:

1. **Backend is not running** ← Most common
2. **Backend returned an error page (HTML) instead of JSON**
3. **API endpoint doesn't exist yet**
4. **CORS (Cross-Origin) error**

### Solution

#### Quick Fix: The portal now has TEST MODE ✅

The updated `kfhonline.html` now:
- ✅ Detects if backend is available
- ✅ Shows connection status at the top
- ✅ Falls back to TEST MODE with mock data
- ✅ Allows you to test all features without backend

**You should see a banner at the top showing:**
- 🧪 **TEST MODE** if backend is not running (orange banner)
- ✅ **Live Mode** if connected to backend (green banner)

### Option 1: Test with TEST MODE (Recommended - No Setup)

The portal will automatically use TEST MODE if backend is not available. You can:

1. Open `frontend/kfhonline.html` in your browser
2. See the orange banner: "🧪 TEST MODE - Using mock data"
3. Click **Buy Gold**, fill the form, and click **Confirm**
4. You'll get a success response with a mock transaction ID
5. All features work exactly the same as with real backend

**This is perfect for demos and testing!**

### Option 2: Connect Real Backend (For Production)

If you want to connect the actual PMIMS backend:

#### Step 1: Start the Backend

```bash
cd backend/PMIMS.WebAPI
dotnet run
```

You should see:
```
Now listening on: http://localhost:8080
```

#### Step 2: Check Backend is Working

Open a new terminal and test the API:

```bash
curl http://localhost:8080/api/kfhonline/prices/gold
```

Expected response:
```json
{"metal":"GOLD","pricePerGram":65.00,"currency":"USD","lastUpdated":"2024-08-01T15:45:00Z"}
```

If you get an error, the backend is running but the endpoint doesn't exist yet. You need to follow the integration guide.

#### Step 3: Refresh KFHOnline

Refresh the browser page. You should now see:
- ✅ **Live Mode** banner (green)
- Real data from the backend

### Troubleshooting Common Errors

#### ❌ "Error: Unexpected end of JSON input"
- **Cause:** Backend returned empty response or invalid JSON
- **Fix:** Verify backend is running on port 8080
- **Check:** `curl http://localhost:8080/api/kfhonline/prices/gold`

#### ❌ Backend shows "Cannot find endpoint"
- **Cause:** API endpoints not integrated yet
- **Fix:** Follow `KFHONLINE_INTEGRATION_GUIDE.md` to complete setup
- **Alternative:** Use TEST MODE to test portal features

#### ❌ CORS error (in browser console)
- **Cause:** Backend CORS not configured
- **Fix:** Check `Program.cs` has CORS middleware enabled:
```csharp
builder.Services.AddCors(options => {
    options.AddPolicy("AllowAll", builder => {
        builder.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});
app.UseCors("AllowAll");
```

#### ❌ Port 8080 already in use
- **Cause:** Another app is using port 8080
- **Fix:** Either stop the other app or change PMIMS port in `appsettings.json`
```json
{
  "Kestrel": {
    "Endpoints": {
      "Http": {
        "Url": "http://localhost:8081"
      }
    }
  }
}
```
Then update in `kfhonline.html`:
```javascript
const API_BASE = 'http://localhost:8081/api/kfhonline';
```

### Check Backend Status in Browser

1. Open browser Developer Tools: **F12** (Windows) or **Cmd+Option+I** (Mac)
2. Go to **Console** tab
3. You'll see messages like:
   - ✓ "Backend connected successfully" → Live Mode ✅
   - ⚠ "Backend not available, using TEST MODE with mock data" → TEST MODE 🧪

### Connection Flowchart

```
Open kfhonline.html
    ↓
Check backend at http://localhost:8080
    ↓
    ├─ ✅ Backend responding → Live Mode (green banner)
    │     └─ API calls go to real backend
    │     └─ Data saved to PMIMS database
    │
    └─ ❌ Backend not responding → TEST MODE (orange banner)
          └─ Mock data used
          └─ Portal fully functional for testing
          └─ No database changes
```

## TEST MODE vs LIVE MODE

| Feature | TEST MODE | LIVE MODE |
|---------|-----------|-----------|
| Requires Backend | ❌ No | ✅ Yes |
| Buy/Sell Works | ✅ Yes | ✅ Yes |
| Delivery Request | ✅ Yes | ✅ Yes |
| Transaction Saved | ❌ Mock only | ✅ Real DB |
| Serial Numbers | ✅ Tracked | ✅ Tracked |
| Price Updates | ✅ Mock varying | ✅ Real rate feed |
| Perfect for Testing | ✅ Yes | ✅ Yes |
| Perfect for Demos | ✅ Yes | ✅ Yes |
| Ready for Production | ❌ No | ✅ Yes |

## What to Do Next

### ✅ Immediate (Now!)
1. Open `kfhonline.html` in browser
2. See the mode indicator at top
3. Test all features (they work in TEST MODE!)

### 📚 Short Term (30 minutes)
1. Read `KFHONLINE_README.md`
2. Read `KFHONLINE_QUICKSTART.md`
3. Test all portal features

### 🔧 Medium Term (1-2 hours)
1. Follow `KFHONLINE_INTEGRATION_GUIDE.md`
2. Complete backend integration
3. Start with real backend

### 🚀 Production (1-2 days)
1. Set up SQL Server database
2. Deploy to production server
3. Configure SSL/TLS
4. Add authentication
5. Enable monitoring

## Portal Features That Work in TEST MODE

✅ **Dashboard**
- KPI cards with statistics
- Recent transactions display
- Account overview

✅ **Buy Gold**
- Customer form
- Real-time price display
- Amount calculation
- Submit order
- Success confirmation
- Transaction ID generation

✅ **Sell Gold**
- Customer form
- Serial number management (add/remove)
- Purity selection
- Amount calculation
- Submit order
- Success confirmation

✅ **Delivery**
- Request form
- Address capture
- Shipping fee calculation
- Submit request
- Delivery ID generation

✅ **History**
- Customer lookup
- Transaction list display
- Gold details with serials
- Status badges

## Need More Help?

1. **Check browser console:** F12 → Console tab
2. **Read the main README:** `KFHONLINE_README.md`
3. **Check integration guide:** `KFHONLINE_INTEGRATION_GUIDE.md`
4. **Backend issues:** Check `AGENTS.md` for PMIMS documentation

---

**Remember:** TEST MODE is intentional and useful! Use it to validate the portal works before connecting the backend. 🧪✅
