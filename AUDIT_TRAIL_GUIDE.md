# 🔍 PMIMS Complete Audit Trail System

## Overview
The PMIMS now has a **unified audit trail** that tracks **ALL operations from ANY channel** (KFHOnline, WebUI, API, batch jobs, etc.) with:
- ✅ Success/Failure status
- 📋 Process type (BUY, SELL, DELIVERY, TRANSFER, etc.)
- 🔴 Issue descriptions when failures occur
- 🛡️ Tamper detection for data integrity

---

## 📊 Two-Level Logging Architecture

### **Level 1: KFHOnline Transaction Log**
**Dedicated tracking for customer buy/sell/delivery operations**
- API: `GET /api/kfhonline/logs`
- Captures: Serial numbers, weights, prices, full request/response JSON
- Status: CONFIRMED, FAILED, PENDING

### **Level 2: PMIMS-Wide Audit Trail**
**System-wide activity log from ANY source**
- API: `GET /api/reports/audit-logs/search`
- Captures: Username, module, action, entity type, timestamp
- Status: Verified/Unverified/Tampered (data integrity check)

---

## 🚀 Quick Start

### **View All Activities (Browser)**
Open: `file:///D:/Projects/Gold2/frontend/pmims-audit-trail.html`

### **View KFHOnline Only**
Filter by Module: "KFHOnline"

### **View Failed Transactions**
Search for: "FAILED" or filter by Status "Tampered"

---

## 📡 API Endpoints

### **1. KFHOnline Transaction Logs**
```
GET /api/kfhonline/logs?status=FAILED&customerId=1&limit=100
```

**Response includes:**
```json
{
  "transactionType": "BUY|SELL|DELIVERY",
  "customerId": 1,
  "customerName": "Ahmed",
  "weightGrams": 100,
  "statusCode": "CONFIRMED|FAILED|PENDING",
  "failureReason": "Bar 13 not available",
  "pricePerGram": 65.50,
  "totalAmount": 6550.00,
  "serials": ["SERIAL-001", "SERIAL-002"],
  "createdAt": "2026-07-04T10:30:00Z"
}
```

### **2. PMIMS Audit Trail Search**
```
GET /api/reports/audit-logs/search?module=KFHOnline&from=2026-07-01&to=2026-07-04
```

**Query Parameters:**
- `query` - Search in action description
- `module` - KFHOnline, Inventory, PurchaseOrders, etc.
- `user` - Filter by username
- `entityType` - Customer, InventoryItem, PurchaseOrder
- `status` - verified, unverified, tampered
- `from` - Start date (YYYY-MM-DD)
- `to` - End date (YYYY-MM-DD)
- `page` - Page number (default 1)
- `pageSize` - Items per page (default 50)

**Response includes:**
```json
{
  "items": [
    {
      "logId": 1,
      "timestamp": "2026-07-04T10:30:00Z",
      "username": "KFHOnline",
      "moduleName": "KFHOnline",
      "actionDescription": "CUSTOMER_BUY: Customer 1 (Ahmed) purchased 100g gold...",
      "entityType": "Customer",
      "entityId": "1",
      "ipAddress": "0.0.0.0",
      "tamperStatus": "Verified"
    }
  ],
  "total_count": 145,
  "page": 1,
  "page_size": 50
}
```

### **3. Get Audit Log Details**
```
GET /api/reports/audit-logs/123
```

### **4. Export Audit Logs**
```
GET /api/reports/audit-logs/export?format=xlsx&module=KFHOnline&status=verified
```

**Formats:** `csv`, `xlsx`, `pdf`

---

## 🎯 Common Use Cases

### **Use Case 1: Track Failed Transactions**
```
GET /api/reports/audit-logs/search?module=KFHOnline&query=FAILED&from=2026-07-01
```
Shows: All failed KFHOnline operations with error details

### **Use Case 2: Audit Trail for Customer #5**
```
GET /api/kfhonline/logs?customerId=5
GET /api/reports/audit-logs/search?entityType=Customer&entityId=5
```
Shows: Everything customer 5 did + system-wide impact

### **Use Case 3: Data Integrity Check**
```
GET /api/reports/audit-logs/search?status=tampered
```
Shows: **ALERT** - Any tampered audit log entries (data corruption)

### **Use Case 4: Weekly Audit Report**
```
GET /api/reports/audit-logs/export?format=pdf&from=2026-06-27&to=2026-07-04
```
Shows: Downloadable PDF with all activities from last week

---

## 📈 What Gets Logged

### **KFHOnline Events:**
✅ Customer BUY transaction (success)
✅ Customer BUY failed (bar not available)
✅ Customer BUY failed (database error)
✅ Customer SELL transaction (success)
✅ Customer SELL failed (no holdings)
✅ Delivery request (submitted)

### **System Events:**
✅ Purchase order received
✅ Inventory transfer
✅ Stocktake session
✅ Reconciliation
✅ User login/logout
✅ Permission changes

---

## 🔐 Security Features

### **1. Tamper Detection**
- Each audit log entry gets a SHA-256 hash
- Hash recomputed on read and compared
- Mismatch = **TAMPERED alert** ⚠️

### **2. IP Address Tracking**
- Records source IP of every operation
- Helps detect unauthorized access

### **3. Module Isolation**
- KFHOnline operations tagged with module="KFHOnline"
- Can't accidentally query/export wrong module data

### **4. Pagination Protection**
- Default 50 items per page
- Prevents accidental export of millions of rows

---

## 📊 Dashboard Features

### **PMIMS Audit Trail Dashboard**
`pmims-audit-trail.html`

**Features:**
- 🔍 Full-text search
- 🏷️ Filter by module, user, entity type
- 📅 Date range filtering
- 📊 Export to XLSX/PDF/CSV
- ✓ Data integrity status display
- 📈 Statistics cards (total, KFHOnline count, verified count)

### **KFHOnline Transaction Logs Dashboard**
`kfhonline-transaction-logs.html`

**Features:**
- 🔍 Search by status (CONFIRMED/FAILED/PENDING)
- 👥 Filter by customer
- 💰 View price, weight, amounts
- ⚠️ Display error messages for failures
- 📅 Date range filtering

---

## 🎓 Example Scenarios

### **Scenario 1: Customer reports transaction failed**
1. Open PMIMS Audit Trail Dashboard
2. Search for customer ID: 5
3. Filter Module: KFHOnline
4. Find failed entry with error message: "Bar 13 not available"
5. Root cause identified! ✓

### **Scenario 2: Check data integrity**
1. Open PMIMS Audit Trail Dashboard
2. Filter Status: "Tampered"
3. If ANY results: **ALERT** - Data corruption detected
4. Investigate immediately

### **Scenario 3: Monthly compliance report**
1. Open PMIMS Audit Trail Dashboard
2. Set date range: June 1-30
3. Click "Export PDF"
4. Submit to compliance team
5. Done! ✓

### **Scenario 4: Understand customer journey**
1. Open PMIMS Audit Trail Dashboard
2. Filter Entity Type: "Customer"
3. Enter Entity ID: 123
4. See every interaction customer 123 had with system
5. Perfect for customer support investigations

---

## 🔄 Integration Points

### **How KFHOnline Integrates:**
1. When customer buys: logs to KFHOnline log + PMIMS audit trail
2. When transaction fails: logs error reason + PMIMS audit trail
3. Failure reasons visible in both dashboards
4. Root causes traceable back to source

### **Example Workflow:**
```
Customer clicks "Confirm Buy"
    ↓
KFHOnlineControllers.BuyGold() called
    ↓
Validates bar exists and is READY
    ↓
If failed → Log to KFHOnlineTransactionLog (FAILED status)
If failed → Log to AuditLog (PMIMS-wide)
    ↓
If success → Update PMIMS inventory (CUSTOMER_CUSTODY)
If success → Log to KFHOnlineTransactionLog (CONFIRMED)
If success → Log to AuditLog (PMIMS-wide)
    ↓
Both logs visible in dashboards
```

---

## 🚨 Troubleshooting

### **Q: Why can't I see KFHOnline logs?**
A: Make sure backend is running: `dotnet run` in `PMIMS.WebAPI` folder

### **Q: Why are some entries "Unverified"?**
A: They were created before tamper-detection feature. Safe to ignore.

### **Q: How do I export last month's KFHOnline failures?**
A: 
```
GET /api/reports/audit-logs/export?format=xlsx&module=KFHOnline&query=FAILED&from=2026-06-01&to=2026-06-30
```

### **Q: Can I see who accessed what?**
A: Yes! Filter by `username` or `ipAddress` in audit trail

---

## 📞 Summary

You now have a **complete, tamper-proof audit trail system** that:
- ✅ Logs ALL operations (KFHOnline + system-wide)
- ✅ Tracks success AND failures with reason
- ✅ Shows process types (BUY, SELL, TRANSFER, etc.)
- ✅ Provides data integrity verification
- ✅ Allows export for compliance
- ✅ Enables investigations and troubleshooting

**Start using it:**
1. Open `pmims-audit-trail.html` in browser
2. Search for KFHOnline activities
3. Check for failures and investigate root causes
4. Export reports for compliance/audit purposes

Perfect for compliance, security audits, and troubleshooting! 🎯
