using System;
using System.Collections.Generic;

namespace PMIMS.Domain;

/// <summary>
/// Customer Transaction Log - tracks buy/sell/deliver operations for KFHOnline customers
/// </summary>
public class CustomerTransaction
{
    public int TransactionId { get; set; }
    public string CustomerId { get; set; } = null!;
    public string CustomerName { get; set; } = null!;
    public string CustomerEmail { get; set; } = null!;
    public string TransactionType { get; set; } = null!; // "BUY", "SELL", "DELIVERY_REQUEST"
    public decimal Amount { get; set; }
    public decimal Weight { get; set; } // in grams
    public decimal PricePerGram { get; set; }
    public string MetalType { get; set; } = null!; // "GOLD", "SILVER", etc.
    public string Purity { get; set; } = null!; // "99.99%", "95%", etc.
    public string Status { get; set; } = "PENDING"; // "PENDING", "CONFIRMED", "COMPLETED", "REJECTED"
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? Notes { get; set; }
    public List<CustomerGoldDetail> GoldDetails { get; set; } = new();
}

/// <summary>
/// Gold Bar Details for each transaction - tracks serial numbers and specifications
/// </summary>
public class CustomerGoldDetail
{
    public int GoldDetailId { get; set; }
    public int TransactionId { get; set; }
    public string SerialNumber { get; set; } = null!;
    public decimal Weight { get; set; } // in grams
    public string Purity { get; set; } = null!;
    public string Denomination { get; set; } = null!; // e.g., "1000g", "500g"
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? VaultLocation { get; set; } // From PMIMS vault coordinates (zone-shelf-slot)
    public string? PMIMSReference { get; set; } // Link to PMIMS inventory item ID
    public CustomerTransaction? Transaction { get; set; }
}

/// <summary>
/// Delivery Request - tracks customer requests to take physical delivery of gold
/// </summary>
public class DeliveryRequest
{
    public int DeliveryId { get; set; }
    public int TransactionId { get; set; }
    public string CustomerId { get; set; } = null!;
    public string Status { get; set; } = "PENDING"; // "PENDING", "APPROVED", "SHIPPED", "DELIVERED", "CANCELLED"
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DeliveryDate { get; set; }
    public string DeliveryAddress { get; set; } = null!;
    public string DeliveryCity { get; set; } = null!;
    public string DeliveryCountry { get; set; } = null!;
    public string ContactPhone { get; set; } = null!;
    public string? ShippingReference { get; set; }
    public decimal ShippingFee { get; set; }
    public string? Notes { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public CustomerTransaction? Transaction { get; set; }
}
