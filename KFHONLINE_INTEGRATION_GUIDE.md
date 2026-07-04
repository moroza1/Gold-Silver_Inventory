# KFHOnline Backend Integration Guide

This guide shows how to complete the integration of KFHOnline with PMIMS. All database setup, DTOs, and repository methods are ready - this shows the final wiring steps.

## Step 1: Add DbSet to AppDbContext

**File:** `backend/PMIMS.Infrastructure/AppDbContext.cs`

Add these lines to the `AppDbContext` class:

```csharp
public DbSet<CustomerTransaction> CustomerTransactions { get; set; } = null!;
public DbSet<CustomerGoldDetail> CustomerGoldDetails { get; set; } = null!;
public DbSet<DeliveryRequest> DeliveryRequests { get; set; } = null!;
```

In the `OnModelCreating` method, add table configuration:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    // ... existing configurations ...

    // Customer Transaction Configuration
    modelBuilder.Entity<CustomerTransaction>(entity =>
    {
        entity.ToTable("customer_transactions");
        entity.HasKey(e => e.TransactionId);
        entity.Property(e => e.TransactionId).HasColumnName("transaction_id");
        entity.Property(e => e.CustomerId).HasColumnName("customer_id").HasMaxLength(50);
        entity.Property(e => e.CustomerName).HasColumnName("customer_name").HasMaxLength(255);
        entity.Property(e => e.CustomerEmail).HasColumnName("customer_email").HasMaxLength(255);
        entity.Property(e => e.TransactionType).HasColumnName("transaction_type").HasMaxLength(20);
        entity.Property(e => e.Amount).HasColumnName("amount").HasPrecision(18, 2);
        entity.Property(e => e.Weight).HasColumnName("weight").HasPrecision(18, 4);
        entity.Property(e => e.PricePerGram).HasColumnName("price_per_gram").HasPrecision(18, 4);
        entity.Property(e => e.MetalType).HasColumnName("metal_type").HasMaxLength(50);
        entity.Property(e => e.Purity).HasColumnName("purity").HasMaxLength(50);
        entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(50);
        entity.Property(e => e.CreatedAt).HasColumnName("created_at");
        entity.Property(e => e.CompletedAt).HasColumnName("completed_at");
        entity.Property(e => e.Notes).HasColumnName("notes");
        
        entity.HasMany(e => e.GoldDetails)
            .WithOne(e => e.Transaction)
            .HasForeignKey(e => e.TransactionId)
            .OnDelete(DeleteBehavior.Cascade);
    });

    // Customer Gold Detail Configuration
    modelBuilder.Entity<CustomerGoldDetail>(entity =>
    {
        entity.ToTable("customer_gold_details");
        entity.HasKey(e => e.GoldDetailId);
        entity.Property(e => e.GoldDetailId).HasColumnName("gold_detail_id");
        entity.Property(e => e.TransactionId).HasColumnName("transaction_id");
        entity.Property(e => e.SerialNumber).HasColumnName("serial_number").HasMaxLength(100);
        entity.Property(e => e.Weight).HasColumnName("weight").HasPrecision(18, 4);
        entity.Property(e => e.Purity).HasColumnName("purity").HasMaxLength(50);
        entity.Property(e => e.Denomination).HasColumnName("denomination").HasMaxLength(50);
        entity.Property(e => e.CreatedAt).HasColumnName("created_at");
        entity.Property(e => e.VaultLocation).HasColumnName("vault_location").HasMaxLength(255);
        entity.Property(e => e.PMIMSReference).HasColumnName("pmims_reference").HasMaxLength(100);
        
        entity.HasIndex(e => e.SerialNumber).IsUnique();
    });

    // Delivery Request Configuration
    modelBuilder.Entity<DeliveryRequest>(entity =>
    {
        entity.ToTable("delivery_requests");
        entity.HasKey(e => e.DeliveryId);
        entity.Property(e => e.DeliveryId).HasColumnName("delivery_id");
        entity.Property(e => e.TransactionId).HasColumnName("transaction_id");
        entity.Property(e => e.CustomerId).HasColumnName("customer_id").HasMaxLength(50);
        entity.Property(e => e.Status).HasColumnName("status").HasMaxLength(50);
        entity.Property(e => e.RequestedAt).HasColumnName("requested_at");
        entity.Property(e => e.DeliveryDate).HasColumnName("delivery_date");
        entity.Property(e => e.DeliveryAddress).HasColumnName("delivery_address");
        entity.Property(e => e.DeliveryCity).HasColumnName("delivery_city").HasMaxLength(100);
        entity.Property(e => e.DeliveryCountry).HasColumnName("delivery_country").HasMaxLength(100);
        entity.Property(e => e.ContactPhone).HasColumnName("contact_phone").HasMaxLength(20);
        entity.Property(e => e.ShippingReference).HasColumnName("shipping_reference").HasMaxLength(100);
        entity.Property(e => e.ShippingFee).HasColumnName("shipping_fee").HasPrecision(18, 2);
        entity.Property(e => e.Notes).HasColumnName("notes");
        entity.Property(e => e.UpdatedAt).HasColumnName("updated_at");
        
        entity.HasOne(e => e.Transaction)
            .WithMany()
            .HasForeignKey(e => e.TransactionId)
            .OnDelete(DeleteBehavior.Restrict);
    });
}
```

## Step 2: Add Repository Methods to Interface

**File:** `backend/PMIMS.Application/Interfaces.cs`

Add these methods to `IInventoryRepository` interface:

```csharp
// KFHOnline Customer Transactions
Task<CustomerTransaction> SaveCustomerTransactionAsync(CustomerTransaction transaction);
Task<CustomerTransaction?> GetCustomerTransactionAsync(int transactionId);
Task<List<CustomerTransaction>> GetCustomerTransactionsAsync(string customerId);
Task<List<CustomerTransaction>> GetPendingTransactionsAsync(string transactionType);

// Delivery Requests
Task<DeliveryRequest> SaveDeliveryRequestAsync(DeliveryRequest delivery);
Task<DeliveryRequest?> GetDeliveryRequestAsync(int deliveryId);
Task<DeliveryRequest?> GetDeliveryRequestByTransactionAsync(int transactionId);
Task UpdateDeliveryStatusAsync(int deliveryId, string newStatus, string? shippingRef = null);

// PMIMS Integration - Serial Number Validation
Task<InventoryItem?> GetInventoryItemBySerialAsync(string serialNumber);
Task<bool> ValidateSerialNumbersAsync(List<string> serialNumbers);
Task<List<InventoryItem>> GetAvailableGoldBarsAsync(decimal weightGrams, string purity = "99.99%");
```

## Step 3: Implement Repository Methods

**File:** `backend/PMIMS.Infrastructure/InventoryRepository.cs`

Add these implementations:

```csharp
/// <summary>
/// Save a new customer transaction (buy/sell/delivery request)
/// </summary>
public async Task<CustomerTransaction> SaveCustomerTransactionAsync(CustomerTransaction transaction)
{
    transaction.CreatedAt = DateTime.UtcNow;
    _context.CustomerTransactions.Add(transaction);
    await _context.SaveChangesAsync();
    return transaction;
}

/// <summary>
/// Get a specific customer transaction with all gold details
/// </summary>
public async Task<CustomerTransaction?> GetCustomerTransactionAsync(int transactionId)
{
    return await _context.CustomerTransactions
        .Include(ct => ct.GoldDetails)
        .FirstOrDefaultAsync(ct => ct.TransactionId == transactionId);
}

/// <summary>
/// Get all transactions for a customer
/// </summary>
public async Task<List<CustomerTransaction>> GetCustomerTransactionsAsync(string customerId)
{
    return await _context.CustomerTransactions
        .Where(ct => ct.CustomerId == customerId)
        .Include(ct => ct.GoldDetails)
        .OrderByDescending(ct => ct.CreatedAt)
        .ToListAsync();
}

/// <summary>
/// Get all pending transactions of a specific type (BUY, SELL, DELIVERY_REQUEST)
/// </summary>
public async Task<List<CustomerTransaction>> GetPendingTransactionsAsync(string transactionType)
{
    return await _context.CustomerTransactions
        .Where(ct => ct.TransactionType == transactionType && ct.Status == "PENDING")
        .Include(ct => ct.GoldDetails)
        .OrderBy(ct => ct.CreatedAt)
        .ToListAsync();
}

/// <summary>
/// Save a delivery request
/// </summary>
public async Task<DeliveryRequest> SaveDeliveryRequestAsync(DeliveryRequest delivery)
{
    delivery.RequestedAt = DateTime.UtcNow;
    _context.DeliveryRequests.Add(delivery);
    await _context.SaveChangesAsync();
    return delivery;
}

/// <summary>
/// Get a specific delivery request
/// </summary>
public async Task<DeliveryRequest?> GetDeliveryRequestAsync(int deliveryId)
{
    return await _context.DeliveryRequests
        .FirstOrDefaultAsync(dr => dr.DeliveryId == deliveryId);
}

/// <summary>
/// Get delivery request for a transaction
/// </summary>
public async Task<DeliveryRequest?> GetDeliveryRequestByTransactionAsync(int transactionId)
{
    return await _context.DeliveryRequests
        .FirstOrDefaultAsync(dr => dr.TransactionId == transactionId);
}

/// <summary>
/// Update delivery request status
/// </summary>
public async Task UpdateDeliveryStatusAsync(int deliveryId, string newStatus, string? shippingRef = null)
{
    var delivery = await _context.DeliveryRequests.FindAsync(deliveryId);
    if (delivery != null)
    {
        delivery.Status = newStatus;
        delivery.UpdatedAt = DateTime.UtcNow;
        if (shippingRef != null)
            delivery.ShippingReference = shippingRef;
        await _context.SaveChangesAsync();
    }
}

/// <summary>
/// Get an inventory item by serial number (from PMIMS)
/// </summary>
public async Task<InventoryItem?> GetInventoryItemBySerialAsync(string serialNumber)
{
    return await _context.InventoryItems
        .FirstOrDefaultAsync(ii => ii.SerialNumber == serialNumber);
}

/// <summary>
/// Validate that all serial numbers exist in PMIMS
/// </summary>
public async Task<bool> ValidateSerialNumbersAsync(List<string> serialNumbers)
{
    var count = await _context.InventoryItems
        .Where(ii => serialNumbers.Contains(ii.SerialNumber))
        .CountAsync();
    return count == serialNumbers.Count;
}

/// <summary>
/// Get available gold bars matching weight and purity for allocation
/// </summary>
public async Task<List<InventoryItem>> GetAvailableGoldBarsAsync(decimal weightGrams, string purity = "99.99%")
{
    return await _context.InventoryItems
        .Where(ii => 
            ii.WeightGrams >= weightGrams && 
            ii.Purity == purity && 
            ii.StatusCode == "AVAILABLE")
        .OrderBy(ii => ii.CreatedAt)
        .Take(10)
        .ToListAsync();
}
```

## Step 4: Update KFHOnlineControllers to Use Repository

**File:** `backend/PMIMS.WebAPI/Controllers/KFHOnlineControllers.cs`

Replace the mock responses in each endpoint. Example for BUY endpoint:

```csharp
[HttpPost("transactions/buy")]
public async Task<IActionResult> BuyGold([FromBody] CustomerBuyRequest req)
{
    if (!ModelState.IsValid)
        return BadRequest(ModelState);

    try
    {
        // Get current gold price
        var pricePerGram = await _rateFeed.GetGoldPricePerGramAsync();

        // Check if bars are available in PMIMS
        var availableBars = await _repository.GetAvailableGoldBarsAsync(req.WeightGrams, req.Purity ?? "99.99%");
        if (availableBars.Count == 0)
            return BadRequest("Not enough gold bars available in vault");

        var transaction = new CustomerTransaction
        {
            CustomerId = req.CustomerId,
            CustomerName = req.CustomerName,
            CustomerEmail = req.CustomerEmail,
            TransactionType = "BUY",
            Weight = req.WeightGrams,
            PricePerGram = pricePerGram,
            Amount = req.WeightGrams * pricePerGram,
            MetalType = "GOLD",
            Purity = req.Purity ?? "99.99%",
            Status = "PENDING",
            Notes = req.Notes
        };

        // Link to PMIMS inventory items
        decimal allocatedWeight = 0;
        foreach (var bar in availableBars)
        {
            if (allocatedWeight >= req.WeightGrams) break;

            var goldDetail = new CustomerGoldDetail
            {
                SerialNumber = bar.SerialNumber,
                Weight = Math.Min(bar.WeightGrams, req.WeightGrams - allocatedWeight),
                Purity = bar.Purity,
                Denomination = bar.Denomination ?? "Bulk",
                VaultLocation = bar.LocationDescription,
                PMIMSReference = bar.ItemId.ToString()
            };
            transaction.GoldDetails.Add(goldDetail);
            allocatedWeight += goldDetail.Weight;
        }

        // Save transaction
        var savedTx = await _repository.SaveCustomerTransactionAsync(transaction);

        return Ok(new
        {
            success = true,
            transactionId = savedTx.TransactionId,
            customerId = req.CustomerId,
            amount = savedTx.Amount,
            weight = savedTx.Weight,
            pricePerGram = pricePerGram,
            status = savedTx.Status,
            goldDetails = savedTx.GoldDetails.Select(gd => new
            {
                gd.SerialNumber,
                gd.Weight,
                gd.VaultLocation,
                gd.PMIMSReference
            }),
            message = $"Buy order created. {req.WeightGrams}g of gold at ${pricePerGram}/g = ${savedTx.Amount:F2}"
        });
    }
    catch (Exception ex)
    {
        return StatusCode(500, new { error = ex.Message });
    }
}
```

Do the same for SELL and DELIVERY endpoints, replacing mock calls with actual repository calls.

## Step 5: Run Database Migration

**Option A: SQLite (Development)**
```bash
cd backend/PMIMS.WebAPI
rm pmims.db  # Delete old database
dotnet run   # Will auto-create with new schema
```

**Option B: SQL Server (Production)**
Create tables manually using this SQL:

```sql
-- Customer Transactions
CREATE TABLE customer_transactions (
    transaction_id INT PRIMARY KEY IDENTITY,
    customer_id NVARCHAR(50) NOT NULL,
    customer_name NVARCHAR(255) NOT NULL,
    customer_email NVARCHAR(255) NOT NULL,
    transaction_type NVARCHAR(20) NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    weight DECIMAL(18, 4) NOT NULL,
    price_per_gram DECIMAL(18, 4) NOT NULL,
    metal_type NVARCHAR(50) NOT NULL,
    purity NVARCHAR(50) NOT NULL,
    status NVARCHAR(50) DEFAULT 'PENDING',
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    completed_at DATETIME2 NULL,
    notes NVARCHAR(MAX) NULL
);

-- Gold Details (linked to transactions)
CREATE TABLE customer_gold_details (
    gold_detail_id INT PRIMARY KEY IDENTITY,
    transaction_id INT NOT NULL,
    serial_number NVARCHAR(100) NOT NULL UNIQUE,
    weight DECIMAL(18, 4) NOT NULL,
    purity NVARCHAR(50) NOT NULL,
    denomination NVARCHAR(50) NOT NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    vault_location NVARCHAR(255) NULL,
    pmims_reference NVARCHAR(100) NULL,
    FOREIGN KEY (transaction_id) REFERENCES customer_transactions(transaction_id) ON DELETE CASCADE
);

-- Delivery Requests
CREATE TABLE delivery_requests (
    delivery_id INT PRIMARY KEY IDENTITY,
    transaction_id INT NOT NULL,
    customer_id NVARCHAR(50) NOT NULL,
    status NVARCHAR(50) DEFAULT 'PENDING',
    requested_at DATETIME2 DEFAULT GETUTCDATE(),
    delivery_date DATETIME2 NULL,
    delivery_address NVARCHAR(MAX) NOT NULL,
    delivery_city NVARCHAR(100) NOT NULL,
    delivery_country NVARCHAR(100) NOT NULL,
    contact_phone NVARCHAR(20) NOT NULL,
    shipping_reference NVARCHAR(100) NULL,
    shipping_fee DECIMAL(18, 2) NOT NULL,
    notes NVARCHAR(MAX) NULL,
    updated_at DATETIME2 NULL,
    FOREIGN KEY (transaction_id) REFERENCES customer_transactions(transaction_id)
);

-- Indexes for performance
CREATE INDEX idx_customer_transactions_customer_id ON customer_transactions(customer_id);
CREATE INDEX idx_customer_transactions_status ON customer_transactions(status);
CREATE INDEX idx_customer_transactions_type ON customer_transactions(transaction_type);
CREATE INDEX idx_delivery_requests_transaction_id ON delivery_requests(transaction_id);
CREATE INDEX idx_delivery_requests_customer_id ON delivery_requests(customer_id);
CREATE INDEX idx_customer_gold_details_transaction_id ON customer_gold_details(transaction_id);
```

## Step 6: Test the Integration

```bash
# Backend
cd backend/PMIMS.WebAPI
dotnet run

# In another terminal, test with curl
curl -X POST http://localhost:8080/api/kfhonline/transactions/buy \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUST-001",
    "customerName": "Ahmed Al-Sabah",
    "customerEmail": "ahmed@example.com",
    "weightGrams": 100,
    "purity": "99.99%"
  }'
```

Expected response:
```json
{
  "success": true,
  "transactionId": 1,
  "customerId": "CUST-001",
  "amount": 6500.00,
  "weight": 100,
  "pricePerGram": 65.00,
  "status": "PENDING",
  "goldDetails": [
    {
      "serialNumber": "AUG-2024-001-A",
      "weight": 100,
      "vaultLocation": "ZONE-A / SHELF-1 / SLOT-5",
      "pmims_reference": "1"
    }
  ],
  "message": "Buy order created..."
}
```

## Summary

✓ Domain entities created (`CustomerEntities.cs`)
✓ API controllers created (`KFHOnlineControllers.cs`)
✓ Customer portal created (`kfhonline.html`)
✓ Documentation created (`KFHONLINE_README.md`)

**TODO (follow steps above):**
- [ ] Add DbSet to AppDbContext
- [ ] Add repository methods to interface
- [ ] Implement repository methods
- [ ] Update controller to use repository
- [ ] Create database tables
- [ ] Test endpoints
- [ ] Add JWT authentication
- [ ] Add authorization policies
- [ ] Deploy to production

**Estimated Time to Complete Integration: 30-45 minutes**
