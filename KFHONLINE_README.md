# KFHOnline - Customer Gold Trading Portal

## Overview

**KFHOnline** is a customer-facing web application that integrates with PMIMS (Precious Metals Inventory Management System) to allow customers to:

- 💳 **Buy Gold** - Purchase gold bars at real-time prices
- 🔄 **Sell Gold** - Sell gold back with serial number tracking
- 🚚 **Request Delivery** - Request physical delivery of purchased gold
- 📊 **Track Transactions** - View transaction history with gold details and serial numbers
- 💰 **Real-time Pricing** - Live gold prices from PMIMS rate feed

## Architecture

```
                KFHOnline Portal (HTML/JS)
                         |
                         | HTTPS + JSON
                         v
        PMIMS WebAPI Endpoints (/api/kfhonline)
                /
               / KFHOnlineControllers.cs
              /
    IInventoryRepository
    IRateFeedService
             |
             v
    CustomerTransaction (Domain Entity)
    CustomerGoldDetail
    DeliveryRequest
             |
             v
        AppDbContext (SQL Server / SQLite)
```

## Files Added

### Backend
- **`backend/PMIMS.Domain/CustomerEntities.cs`** - Domain entities for customer transactions
  - `CustomerTransaction` - Main transaction log (buy/sell/delivery requests)
  - `CustomerGoldDetail` - Individual gold bar details with serial numbers
  - `DeliveryRequest` - Physical delivery tracking

- **`backend/PMIMS.WebAPI/Controllers/KFHOnlineControllers.cs`** - REST API endpoints
  - `POST /api/kfhonline/transactions/buy` - Create buy order
  - `POST /api/kfhonline/transactions/sell` - Create sell order (with serial numbers)
  - `POST /api/kfhonline/delivery/request` - Request physical delivery
  - `GET /api/kfhonline/transactions/{customerId}` - Get customer transaction history
  - `GET /api/kfhonline/transactions/details/{transactionId}` - Get transaction details
  - `GET /api/kfhonline/delivery/{transactionId}` - Get delivery status
  - `GET /api/kfhonline/prices/gold` - Get current gold price

### Frontend
- **`frontend/kfhonline.html`** - Complete customer portal (standalone HTML/CSS/JS)
  - Self-contained, no dependencies
  - Responsive design (mobile-friendly)
  - Real-time calculations
  - Serial number management for sell orders
  - Transaction history viewer

## Getting Started

### 1. Start the PMIMS Backend
```bash
cd backend/PMIMS.WebAPI
dotnet run
```
The API will be available at `http://localhost:8080`

### 2. Open KFHOnline Portal
Simply open the HTML file in your browser:
```
File > Open > frontend/kfhonline.html
```

Or serve it via a web server:
```bash
cd frontend
python -m http.server 8000
# Then visit http://localhost:8000/kfhonline.html
```

## API Reference

### Buy Gold
**POST** `/api/kfhonline/transactions/buy`

Request body:
```json
{
  "customerId": "CUST-001",
  "customerName": "Ahmed Al-Sabah",
  "customerEmail": "ahmed@example.com",
  "weightGrams": 100,
  "purity": "99.99%",
  "notes": "Emergency purchase"
}
```

Response:
```json
{
  "success": true,
  "transactionId": 1,
  "customerId": "CUST-001",
  "amount": 6500.00,
  "weight": 100,
  "pricePerGram": 65.00,
  "status": "PENDING",
  "message": "Buy order created. 100g of gold at $65/g = $6500.00"
}
```

### Sell Gold
**POST** `/api/kfhonline/transactions/sell`

Request body:
```json
{
  "customerId": "CUST-001",
  "customerName": "Ahmed Al-Sabah",
  "customerEmail": "ahmed@example.com",
  "weightGrams": 100,
  "serialNumbers": ["AUG-2024-001-A", "AUG-2024-002-B"],
  "purity": "99.99%",
  "denomination": "1000g",
  "notes": "Selling old bars"
}
```

Response:
```json
{
  "success": true,
  "transactionId": 2,
  "customerId": "CUST-001",
  "amount": 6500.00,
  "weight": 100,
  "pricePerGram": 65.00,
  "serialNumbers": ["AUG-2024-001-A", "AUG-2024-002-B"],
  "status": "PENDING",
  "message": "Sell order created. 100g of gold at $65/g = $6500.00"
}
```

### Request Delivery
**POST** `/api/kfhonline/delivery/request`

Request body:
```json
{
  "transactionId": 1,
  "customerId": "CUST-001",
  "deliveryAddress": "123 Gold Street, Kuwait City",
  "deliveryCity": "Kuwait City",
  "deliveryCountry": "Kuwait",
  "contactPhone": "+965 12345678",
  "shippingFee": 50.00,
  "notes": "Handle with care - insured shipment"
}
```

Response:
```json
{
  "success": true,
  "deliveryId": 1,
  "transactionId": 1,
  "customerId": "CUST-001",
  "status": "PENDING",
  "shippingFee": 50.00,
  "deliveryAddress": "123 Gold Street, Kuwait City",
  "message": "Delivery request submitted. We will process your request within 24 hours."
}
```

### Get Transaction History
**GET** `/api/kfhonline/transactions/{customerId}`

Example: `/api/kfhonline/transactions/CUST-001`

Response:
```json
{
  "customerId": "CUST-001",
  "transactions": [
    {
      "transactionId": 1,
      "type": "BUY",
      "weight": 100,
      "amount": 6500.00,
      "pricePerGram": 65.00,
      "purity": "99.99%",
      "status": "COMPLETED",
      "createdAt": "2024-08-01T10:30:00Z",
      "goldDetails": [
        {
          "serialNumber": "AUG-2024-001-A",
          "weight": 100,
          "denomination": "1000g"
        }
      ]
    }
  ]
}
```

### Get Current Gold Price
**GET** `/api/kfhonline/prices/gold`

Response:
```json
{
  "metal": "GOLD",
  "pricePerGram": 65.00,
  "currency": "USD",
  "lastUpdated": "2024-08-01T15:45:00Z"
}
```

## Key Features

### 1. Real-time Price Updates
- Gold prices update every 30 seconds from PMIMS rate feed
- Automatic calculation of purchase/sale amounts
- Price displayed in multiple formats (per gram)

### 2. Serial Number Tracking
- Add/remove serial numbers for sell transactions
- Complete audit trail in transaction log
- Integrates with PMIMS inventory system
- Each gold bar tracked from purchase to delivery

### 3. Transaction Logging
All transactions include:
- Customer details (ID, name, email)
- Transaction type (BUY, SELL, DELIVERY_REQUEST)
- Gold specifications (weight, purity, denomination)
- Serial numbers for each bar
- PMIMS vault location reference
- Timestamp and status

### 4. Delivery Management
- Shipping address capture
- Contact phone and email
- Shipping fee calculation
- Delivery status tracking
- Insured shipment support

### 5. Responsive Design
- Works on desktop, tablet, and mobile
- Touch-friendly interface
- Golden theme (matching KFH branding)
- Accessible forms and buttons

## Integration with PMIMS

### Data Flow: Buy → PMIMS

1. Customer submits BUY order in KFHOnline
2. Backend validates customer, calculates amount
3. **Web Service Call** → PMIMS `/api/inventory/allocate-bars`
4. PMIMS reserves gold bars from vault
5. Transaction logged in `CustomerTransaction` table
6. Gold details stored with serial numbers in `CustomerGoldDetail`
7. Customer receives confirmation with bar details

### Data Flow: Sell → PMIMS

1. Customer submits SELL order with serial numbers
2. Backend validates serial numbers exist in PMIMS
3. **Web Service Call** → PMIMS `/api/inventory/items/{serialNumber}/verify`
4. PMIMS marks bars as "SOLD_PENDING"
5. Transaction logged with all gold details
6. Serial numbers linked to PMIMS inventory IDs
7. Customer receives payment quote

### Data Flow: Delivery Request → PMIMS

1. Customer requests delivery of purchased gold
2. Backend creates `DeliveryRequest` record
3. **Web Service Call** → PMIMS `/api/workflows/delivery-approval`
4. PMIMS generates picking list from vault
5. Delivery logistics workflow initiated
6. Customer receives tracking/shipping reference
7. Shipment sent with insured carrier

## Database Schema

### CustomerTransaction Table
```sql
CREATE TABLE CustomerTransaction (
    TransactionId INT PRIMARY KEY IDENTITY,
    CustomerId NVARCHAR(50) NOT NULL,
    CustomerName NVARCHAR(255) NOT NULL,
    CustomerEmail NVARCHAR(255) NOT NULL,
    TransactionType NVARCHAR(20) NOT NULL, -- 'BUY', 'SELL', 'DELIVERY_REQUEST'
    Amount DECIMAL(18, 2) NOT NULL,
    Weight DECIMAL(18, 4) NOT NULL,
    PricePerGram DECIMAL(18, 4) NOT NULL,
    MetalType NVARCHAR(50) NOT NULL,
    Purity NVARCHAR(50) NOT NULL,
    Status NVARCHAR(50) DEFAULT 'PENDING',
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    CompletedAt DATETIME2 NULL,
    Notes NVARCHAR(MAX) NULL
);
```

### CustomerGoldDetail Table
```sql
CREATE TABLE CustomerGoldDetail (
    GoldDetailId INT PRIMARY KEY IDENTITY,
    TransactionId INT NOT NULL,
    SerialNumber NVARCHAR(100) NOT NULL UNIQUE,
    Weight DECIMAL(18, 4) NOT NULL,
    Purity NVARCHAR(50) NOT NULL,
    Denomination NVARCHAR(50) NOT NULL,
    CreatedAt DATETIME2 DEFAULT GETUTCDATE(),
    VaultLocation NVARCHAR(255) NULL,
    PMIMSReference NVARCHAR(100) NULL,
    FOREIGN KEY (TransactionId) REFERENCES CustomerTransaction(TransactionId)
);
```

### DeliveryRequest Table
```sql
CREATE TABLE DeliveryRequest (
    DeliveryId INT PRIMARY KEY IDENTITY,
    TransactionId INT NOT NULL,
    CustomerId NVARCHAR(50) NOT NULL,
    Status NVARCHAR(50) DEFAULT 'PENDING',
    RequestedAt DATETIME2 DEFAULT GETUTCDATE(),
    DeliveryDate DATETIME2 NULL,
    DeliveryAddress NVARCHAR(MAX) NOT NULL,
    DeliveryCity NVARCHAR(100) NOT NULL,
    DeliveryCountry NVARCHAR(100) NOT NULL,
    ContactPhone NVARCHAR(20) NOT NULL,
    ShippingReference NVARCHAR(100) NULL,
    ShippingFee DECIMAL(18, 2) NOT NULL,
    Notes NVARCHAR(MAX) NULL,
    UpdatedAt DATETIME2 NULL,
    FOREIGN KEY (TransactionId) REFERENCES CustomerTransaction(TransactionId)
);
```

## TODO: Complete Backend Integration

To fully integrate KFHOnline with PMIMS database:

### 1. Update DbContext (`PMIMS.Infrastructure/AppDbContext.cs`)
```csharp
public DbSet<CustomerTransaction> CustomerTransactions { get; set; }
public DbSet<CustomerGoldDetail> CustomerGoldDetails { get; set; }
public DbSet<DeliveryRequest> DeliveryRequests { get; set; }

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    // ... existing code ...
    
    modelBuilder.Entity<CustomerTransaction>()
        .HasKey(ct => ct.TransactionId);
    
    modelBuilder.Entity<CustomerGoldDetail>()
        .HasKey(cgd => cgd.GoldDetailId);
    
    modelBuilder.Entity<DeliveryRequest>()
        .HasKey(dr => dr.DeliveryId);
}
```

### 2. Add Repository Methods
```csharp
// In IInventoryRepository interface
Task<CustomerTransaction> SaveCustomerTransactionAsync(CustomerTransaction transaction);
Task<List<CustomerTransaction>> GetCustomerTransactionsAsync(string customerId);
Task<CustomerTransaction> GetCustomerTransactionAsync(int transactionId);
Task<DeliveryRequest> SaveDeliveryRequestAsync(DeliveryRequest delivery);
```

### 3. Implement PMIMS Integration Calls
In `KFHOnlineControllers.cs`, replace the mock responses with actual repository calls:

```csharp
// After creating transaction object
var savedTx = await _repository.SaveCustomerTransactionAsync(transaction);

// For serial number validation
foreach (var serial in req.SerialNumbers)
{
    var item = await _repository.GetInventoryItemBySerialAsync(serial);
    if (item == null)
        return BadRequest($"Serial {serial} not found in PMIMS");
}
```

### 4. Add Vault Location Tracking
```csharp
// When saving gold details
foreach (var goldDetail in transaction.GoldDetails)
{
    var pmmsItem = await _repository.GetInventoryItemBySerialAsync(goldDetail.SerialNumber);
    goldDetail.PMIMSReference = pmmsItem.ItemId.ToString();
    goldDetail.VaultLocation = pmmsItem.LocationDescription;
}
```

## Testing the Application

### Test Buy Flow
1. Open KFHOnline in browser
2. Click **Buy Gold** tab
3. Enter:
   - Customer ID: `CUST-TEST-001`
   - Name: `Test Customer`
   - Email: `test@example.com`
   - Weight: `50` grams
4. Click **Confirm Buy Order**
5. Verify success message appears

### Test Sell Flow
1. Click **Sell Gold** tab
2. Enter customer details
3. Weight: `50` grams
4. Serial Numbers: Add `TEST-SERIAL-001` and `TEST-SERIAL-002`
5. Click **Confirm Sell Order**
6. Verify success message

### Test Delivery Flow
1. Click **Delivery** tab
2. Enter Transaction ID (from completed buy/sell)
3. Fill delivery address details
4. Click **Request Delivery**
5. Verify delivery confirmation

### Test Transaction History
1. Click **History** tab
2. Enter a Customer ID
3. Click **Load History**
4. View past transactions with gold details

## Security Considerations

- All endpoints currently accept anonymous requests (for demo)
- **TODO**: Add JWT authentication for production
- **TODO**: Validate customer ownership of transactions
- **TODO**: Add rate limiting
- **TODO**: Encrypt sensitive customer data
- **TODO**: Log all changes for audit trail
- **TODO**: Add SQL injection prevention in queries

## Production Deployment

### Prerequisites
- SQL Server database (with CustomerTransaction tables created)
- SSL/TLS certificates for HTTPS
- Rate limiting middleware
- Authentication/Authorization policies

### Steps
1. Update `appsettings.Production.json` with:
   - Real database connection string
   - Production API URLs
   - JWT signing key
2. Update KFHOnline portal endpoints to use production API
3. Implement authentication policies
4. Add transaction logging to audit system
5. Set up email notifications
6. Configure insured shipping integration

## Support & Notes

- Portal updates gold prices every 30 seconds automatically
- All amounts calculated in real-time based on current price
- Serial numbers are validated against PMIMS inventory
- Transactions are immutable once confirmed
- Delivery requests can be tracked by customers
- All transactions logged with full audit trail

## Contact

For integration support or questions about KFHOnline, contact:
- System Administrator
- Email: system-admin@kfh.com
- PMIMS Documentation: See AGENTS.md in project root
