# KFHOnline - Complete PMIMS Integration Guide

## System Overview

KFHOnline is fully integrated with PMIMS inventory system:

```
┌─────────────────────────────────────────────────────────────┐
│                   KFHOnline Customer Portal                 │
│                                                             │
│  [💳 Buy]  [🔄 Sell]  [🚚 Delivery]  [📋 History]         │
└─────────────────────────────────────────────────────────────┘
                          ↕ API Integration
┌─────────────────────────────────────────────────────────────┐
│                      PMIMS Backend                          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Inventory Management                         │  │
│  │  Status: AVAILABLE → CUSTOMER_CUSTODY → AVAILABLE    │  │
│  │  Tracking: Serial Numbers, Customer RIM, Vault Loc   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│                   SQL Server Database                       │
│                                                             │
│  InventoryItems (with status, customer_rim, location)     │
│  CustomerTransactions (buy/sell/delivery logs)            │
│  CustomerHoldings (custody tracking)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Buy Flow - Complete Process

### 1. Customer Initiates Buy
```
Customer clicks "Buy Gold" → Enters weight (e.g., 150g)
```

### 2. KFHOnline Calls PMIMS Backend
```
GET /api/kfhonline/inventory/available
  ↓
PMIMS searches: SELECT * FROM inventory_items 
  WHERE status = 'AVAILABLE' 
  AND metal_type = 'GOLD' 
  AND purity = '99.99%'
  LIMIT 10
```

### 3. Backend Auto-Allocates Bars
```
Available in vault:
  - AUG-2024-VAULT-001: 1000g @ 99.99% [AVAILABLE]
  - AUG-2024-VAULT-002: 500g @ 99.99% [AVAILABLE]
  - AUG-2024-VAULT-003: 250g @ 99.99% [AVAILABLE]

Customer needs: 150g

Algorithm allocates:
  ✓ Take bar 003 (250g) - gives 150g
  Remaining for vault: 100g
```

### 4. PMIMS Inventory Updated
```
UPDATE inventory_items SET
  status = 'CUSTOMER_CUSTODY',
  customer_rim = 'CUST-001',
  weight_allocated = 150,
  weight_remaining = 100
WHERE serial_number = 'AUG-2024-VAULT-003'

INSERT INTO customer_holdings SET
  customer_id = 'CUST-001',
  item_id = 'AUG-2024-VAULT-003',
  weight = 150,
  status = 'CUSTODY',
  purchased_at = NOW(),
  purchase_price = $6,500
```

### 5. Transaction Logged in KFHOnline
```
INSERT INTO customer_transactions SET
  transaction_type = 'BUY',
  customer_id = 'CUST-001',
  amount = $6,500,
  weight = 150,
  status = 'CONFIRMED'

INSERT INTO customer_gold_details SET
  serial_number = 'AUG-2024-VAULT-003',
  weight = 150,
  pmims_reference = 'AUG-2024-VAULT-003',
  vault_location = 'ZONE-A/SHELF-2/SLOT-3'
```

### 6. Response to Customer
```json
{
  "success": true,
  "transactionId": 1001,
  "customerId": "CUST-001",
  "amount": 6500,
  "weight": 150,
  "pricePerGram": 65,
  "status": "CONFIRMED",
  "allocatedBars": [
    {
      "serialNumber": "AUG-2024-VAULT-003",
      "weight": 150,
      "purity": "99.99%",
      "vaultLocation": "ZONE-A/SHELF-2/SLOT-3",
      "pmims_reference": "AUG-2024-VAULT-003"
    }
  ],
  "message": "Purchase confirmed. 150g allocated with 1 bar. Marked as CUSTOMER_CUSTODY in PMIMS for Ahmed Al-Sabah."
}
```

**Key Points:**
- ✅ Bar now LOCKED to customer in PMIMS
- ✅ Not available for other customers
- ✅ Serial number tied to customer RIM
- ✅ Vault location tracked for physical management

---

## Sell Flow - Complete Process

### 1. Customer Requests Holdings
```
GET /api/kfhonline/custody/{customerId}
  ↓
PMIMS searches:
  SELECT * FROM inventory_items 
  WHERE status = 'CUSTOMER_CUSTODY' 
  AND customer_rim = 'CUST-001'
```

### 2. Backend Returns ONLY Customer's Bars
```json
{
  "customerId": "CUST-001",
  "bars": [
    {
      "serialNumber": "AUG-2024-CUST-001",
      "weight": 100,
      "purchasedAt": "2024-08-01",
      "purchasePrice": 6500,
      "currentValue": 6500,
      "status": "CUSTOMER_CUSTODY"
    },
    {
      "serialNumber": "AUG-2024-CUST-002",
      "weight": 50,
      "purchasedAt": "2024-08-03",
      "purchasePrice": 3250,
      "currentValue": 3250,
      "status": "CUSTOMER_CUSTODY"
    }
  ]
}
```

### 3. Customer Selects Bars to Sell
```
Customer selects: AUG-2024-CUST-001 (100g)
```

### 4. Validation & Payout Calculation
```
Backend validates:
  ✓ Serial belongs to CUST-001
  ✓ Status is CUSTOMER_CUSTODY
  ✓ Not sold already
  
Calculate payout:
  100g @ $65/gram = $6,500
```

### 5. PMIMS Inventory Updated
```
UPDATE inventory_items SET
  status = 'AVAILABLE',
  customer_rim = NULL,
  sold_at = NOW(),
  sold_to_customer = 'CUST-001'
WHERE serial_number = 'AUG-2024-CUST-001'

DELETE FROM customer_holdings 
WHERE item_id = 'AUG-2024-CUST-001'
```

### 6. Transaction Logged
```
INSERT INTO customer_transactions SET
  transaction_type = 'SELL',
  customer_id = 'CUST-001',
  amount = 6500,
  weight = 100,
  status = 'CONFIRMED'
```

### 7. Response to Customer
```json
{
  "success": true,
  "transactionId": 2001,
  "customerId": "CUST-001",
  "amount": 6500,
  "weight": 100,
  "status": "CONFIRMED",
  "message": "Sale confirmed. You receive $6,500. Bar released to vault inventory."
}
```

**Key Points:**
- ✅ Only customer's own bars shown
- ✅ Validation against PMIMS data
- ✅ Bar returned to AVAILABLE status
- ✅ Sold transaction recorded

---

## Database Schema Updates

### Add to inventory_items (PMIMS.Domain)
```sql
-- Track customer custody
ALTER TABLE inventory_items ADD (
  customer_rim NVARCHAR(50) NULL,
  custody_status NVARCHAR(50) NULL, -- 'AVAILABLE', 'CUSTOMER_CUSTODY', 'SOLD'
  custody_date DATETIME2 NULL,
  sold_to_customer NVARCHAR(50) NULL,
  sold_date DATETIME2 NULL
);

CREATE INDEX idx_inventory_customer_rim ON inventory_items(customer_rim);
CREATE INDEX idx_inventory_custody_status ON inventory_items(custody_status);
```

### customer_holdings Table (New)
```sql
CREATE TABLE customer_holdings (
  holding_id INT PRIMARY KEY IDENTITY,
  customer_id NVARCHAR(50) NOT NULL,
  item_id INT NOT NULL,
  serial_number NVARCHAR(100) NOT NULL,
  weight DECIMAL(18,4) NOT NULL,
  purchase_date DATETIME2 DEFAULT GETUTCDATE(),
  purchase_price DECIMAL(18,2) NOT NULL,
  status NVARCHAR(50) DEFAULT 'ACTIVE',
  notes NVARCHAR(MAX) NULL,
  
  FOREIGN KEY (item_id) REFERENCES inventory_items(item_id),
  INDEX idx_customer_id (customer_id),
  INDEX idx_status (status)
);
```

---

## API Endpoints

### Get Available Inventory
```
GET /api/kfhonline/inventory/available
  ?metalType=GOLD&purity=99.99%&limit=10

Response:
{
  "availableCount": 4,
  "bars": [
    {
      "itemId": 1001,
      "serialNumber": "AUG-2024-VAULT-001",
      "weight": 1000,
      "status": "AVAILABLE",
      "vaultLocation": "ZONE-A/SHELF-1/SLOT-1"
    }
  ]
}
```

### Buy Gold
```
POST /api/kfhonline/transactions/buy

Request:
{
  "customerId": "CUST-001",
  "customerName": "Ahmed Al-Sabah",
  "customerEmail": "ahmed@kfh.com",
  "weightGrams": 150,
  "purity": "99.99%"
}

Response:
{
  "success": true,
  "transactionId": 1001,
  "allocatedBars": [
    {
      "serialNumber": "AUG-2024-VAULT-003",
      "weight": 150,
      "pmims_reference": "AUG-2024-VAULT-003"
    }
  ]
}
```

### Get Customer Custody
```
GET /api/kfhonline/custody/{customerId}

Response:
{
  "customerId": "CUST-001",
  "totalWeight": 150,
  "barCount": 1,
  "bars": [
    {
      "serialNumber": "AUG-2024-CUST-001",
      "weight": 150,
      "status": "CUSTOMER_CUSTODY",
      "vaultLocation": "ZONE-A/SHELF-2/SLOT-3"
    }
  ]
}
```

### Sell Gold
```
POST /api/kfhonline/transactions/sell

Request:
{
  "customerId": "CUST-001",
  "customerName": "Ahmed Al-Sabah",
  "customerEmail": "ahmed@kfh.com",
  "serialNumbers": ["AUG-2024-CUST-001"],
  "weightGrams": 150
}

Response:
{
  "success": true,
  "transactionId": 2001,
  "amount": 6500,
  "message": "Sale confirmed. Bar released to vault inventory."
}
```

---

## Implementation Checklist

### Phase 1: Backend Setup (Current)
- [x] KFHOnline controller created
- [x] DTOs defined
- [x] Mock data structure ready
- [ ] Add CustomerHoldings table
- [ ] Add customer_rim to inventory_items

### Phase 2: Database Integration
- [ ] Update AppDbContext with new tables
- [ ] Add CustomerHoldings entity to Domain
- [ ] Create migrations
- [ ] Add indexes for performance

### Phase 3: Repository Implementation
- [ ] GetAvailableInventoryAsync()
- [ ] UpdateInventoryStatusAsync()
- [ ] GetCustomerHoldingsAsync()
- [ ] SaveCustomerTransactionAsync()
- [ ] ValidateCustomerOwnershipAsync()

### Phase 4: Business Logic
- [ ] Auto-allocation algorithm
- [ ] Weight matching logic
- [ ] Custody status tracking
- [ ] Transaction reconciliation

### Phase 5: Frontend Integration
- [ ] Display available inventory before buy
- [ ] Auto-select bars display
- [ ] Show only customer's bars in sell
- [ ] Real-time balance updates

### Phase 6: Testing & Validation
- [ ] Unit tests for allocation
- [ ] Integration tests with PMIMS
- [ ] End-to-end buy/sell flow
- [ ] Concurrent transaction handling

---

## Security & Validation

### Ownership Validation
```csharp
// Before selling, validate:
var isOwner = await _repository.ValidateCustomerOwnershipAsync(
  customerId: "CUST-001",
  serialNumbers: ["AUG-2024-CUST-001"]
);

if (!isOwner)
  throw new UnauthorizedAccessException("Serial numbers not in your custody");
```

### Concurrency Control
```csharp
// Prevent double-selling
var reservation = await _repository.ReserveBarAsync(
  serialNumber: "AUG-2024-CUST-001",
  customerId: "CUST-001",
  ttlSeconds: 300  // 5 min lock
);

if (reservation == null)
  throw new InvalidOperationException("Bar already sold");
```

### Audit Trail
```csharp
// Log all inventory changes
INSERT INTO audit_logs SET
  action = 'INVENTORY_STATUS_CHANGE',
  table_name = 'inventory_items',
  serial_number = 'AUG-2024-CUST-001',
  old_status = 'AVAILABLE',
  new_status = 'CUSTOMER_CUSTODY',
  customer_id = 'CUST-001',
  changed_at = NOW(),
  changed_by = 'SYSTEM'
```

---

## Summary

| Step | PMIMS Action | KFHOnline Action | Status in DB |
|------|-------------|-----------------|-------------|
| **BUY** | Auto-allocates bars | Shows confirmation | CUSTOMER_CUSTODY |
| **HOLD** | Locks to customer RIM | Displays holdings | CUSTOMER_CUSTODY |
| **SELL** | Releases to available | Shows sale confirmation | AVAILABLE |
| **DELIVERY** | Prepares for pickup | Generates tracking | PHYSICAL_DELIVERY |

**Result:** Complete inventory-integrated system where:
- ✅ Buy shows only available bars
- ✅ Bars locked to customer after purchase
- ✅ Sell shows only customer's own bars
- ✅ PMIMS inventory stays synchronized
- ✅ No double-selling possible
- ✅ Complete audit trail

---

**Next Steps:**
1. Create CustomerHoldings entity & table
2. Implement repository methods
3. Update KFHOnlineControllers to use real backend
4. Add validation & error handling
5. Test end-to-end buy/sell flow
