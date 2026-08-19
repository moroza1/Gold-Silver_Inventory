using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

/// <summary>
/// KFHOnline Customer Portal API - handles customer buy/sell/delivery operations
/// This is a public-facing interface for KFH customers to trade gold and request delivery
/// </summary>
[ApiController]
[Route("api/kfhonline")]
public partial class KFHOnlineControllers : ControllerBase
{
    private readonly IInventoryRepository _repository;
    private readonly IRateFeedService _rateFeed;

    public KFHOnlineControllers(
        IInventoryRepository repository,
        IRateFeedService rateFeed)
    {
        _repository = repository;
        _rateFeed = rateFeed;
    }

    // =========================================================================
    // 1. CUSTOMER TRANSACTION - BUY GOLD
    // =========================================================================
    /// <summary>
    /// Customer initiates a BUY transaction to purchase gold
    /// </summary>
    [AllowAnonymous]
    [HttpPost("transactions/buy")]
    public async Task<IActionResult> BuyGold([FromBody] CustomerBuyRequest req)
    {
        var logEntry = new KFHOnlineTransactionLog
        {
            TransactionType = "BUY",
            CustomerId = int.TryParse(req.CustomerId, out var cid) ? cid : 0,
            CustomerName = req.CustomerName ?? "Unknown",
            WeightGrams = req.WeightGrams,
            SerialsJson = req.SerialNumbers != null ? JsonSerializer.Serialize(req.SerialNumbers) : null,
            Purity = req.Purity,
            Notes = req.Notes,
            RequestJson = JsonSerializer.Serialize(req),
            StatusCode = "PENDING"
        };

        if (!ModelState.IsValid)
        {
            var errors = ModelState.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage).ToList();
            logEntry.StatusCode = "FAILED";
            logEntry.FailureReason = string.Join("; ", errors);
            await _repository.LogKFHOnlineTransactionAsync(logEntry);
            return BadRequest(new { error = "Validation failed", details = errors, receivedData = req });
        }

        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                logEntry.StatusCode = "FAILED";
                logEntry.FailureReason = "No bars selected for purchase";
                await _repository.LogKFHOnlineTransactionAsync(logEntry);
                return BadRequest(new { error = "No bars selected for purchase" });
            }

            // Get current gold price
            var (bidPrice, askPrice, source) = await _rateFeed.GetLiveRatesAsync("GOLD");
            var pricePerGram = bidPrice;

            // Get the bars by serial numbers
            var bars = new List<InventoryItem>();
            foreach (var serial in req.SerialNumbers)
            {
                var bar = await _repository.GetItemBySerialNumberAsync(serial);
                if (bar == null)
                {
                    logEntry.StatusCode = "FAILED";
                    logEntry.FailureReason = $"Bar {serial} not found";
                    await _repository.LogKFHOnlineTransactionAsync(logEntry);
                    return NotFound(new { error = $"Bar {serial} not found" });
                }
                if (bar.StatusCode != "READY")
                {
                    logEntry.StatusCode = "FAILED";
                    logEntry.FailureReason = $"Bar {serial} is not available for purchase (Status: {bar.StatusCode})";
                    await _repository.LogKFHOnlineTransactionAsync(logEntry);
                    // Log to PMIMS Audit Trail
                    await _repository.SaveAuditLogAsync("KFHOnline", "0.0.0.0", "KFHOnline", $"CUSTOMER_BUY_FAILED: Bar {serial} unavailable (Status: {bar.StatusCode})", entityType: "InventoryItem", entityId: serial);
                    return BadRequest(new { error = $"Bar {serial} is not available for purchase" });
                }
                bars.Add(bar);
            }

            // Update inventory items to CUSTOMER_CUSTODY and create holdings
            string customerRim = req.CustomerId ?? "0";
            if (string.IsNullOrWhiteSpace(customerRim))
            {
                logEntry.StatusCode = "FAILED";
                logEntry.FailureReason = "Invalid customer ID";
                await _repository.LogKFHOnlineTransactionAsync(logEntry);
                return BadRequest(new { error = "Invalid customer ID" });
            }

            var itemIds = bars.Select(b => b.ItemId).ToList();

            // Save purchase to PMIMS (update status + create holdings)
            try
            {
                bool saved = await _repository.PurchaseBarsAsync(customerRim, req.CustomerName ?? "Unknown", itemIds);
                if (!saved)
                {
                    logEntry.StatusCode = "FAILED";
                    logEntry.FailureReason = "Database save failed";
                    logEntry.PricePerGram = pricePerGram;
                    logEntry.TotalAmount = req.WeightGrams * pricePerGram;
                    await _repository.LogKFHOnlineTransactionAsync(logEntry);
                    return StatusCode(500, new { error = "Failed to save purchase to database - check backend logs for details" });
                }
            }
            catch (Exception dbEx)
            {
                logEntry.StatusCode = "FAILED";
                logEntry.FailureReason = $"Database error: {dbEx.Message}";
                logEntry.PricePerGram = pricePerGram;
                logEntry.TotalAmount = req.WeightGrams * pricePerGram;
                await _repository.LogKFHOnlineTransactionAsync(logEntry);
                return StatusCode(500, new { error = $"Database error: {dbEx.Message}" });
            }

            // Log successful transaction
            logEntry.StatusCode = "CONFIRMED";
            logEntry.PricePerGram = pricePerGram;
            logEntry.TotalAmount = req.WeightGrams * pricePerGram;
            var responseData = new
            {
                success = true,
                transactionId = new Random().Next(10000, 99999),
                customerId = req.CustomerId,
                amount = req.WeightGrams * pricePerGram,
                weight = req.WeightGrams,
                pricePerGram = pricePerGram,
                barsPurchased = req.SerialNumbers.Count,
                status = "CONFIRMED",
                message = $"✓ Purchase confirmed! {req.WeightGrams}g across {req.SerialNumbers.Count} bar(s) at ${pricePerGram}/g = ${(req.WeightGrams * pricePerGram):F2}\n\nBars are now marked as CUSTOMER_CUSTODY in PMIMS.",
                allocatedBars = bars.Select(b => new
                {
                    serialNumber = b.SerialNumber,
                    weight = b.Product?.Denomination?.WeightGrams ?? 0,
                    pmims_reference = b.ItemId.ToString(),
                    vaultLocation = $"{b.Location?.ZoneRoom ?? "?"}/{b.Location?.ShelfRow ?? "?"}/{b.Location?.SlotBin ?? "?"}"
                }).ToList()
            };
            logEntry.ResponseJson = JsonSerializer.Serialize(responseData);
            await _repository.LogKFHOnlineTransactionAsync(logEntry);

            // Also log to PMIMS Audit Trail (system-wide)
            var auditDesc = $"CUSTOMER_BUY: Customer {customerRim} ({req.CustomerName}) purchased {req.WeightGrams}g gold, ${(req.WeightGrams * pricePerGram):F2}, serial(s): {string.Join(", ", req.SerialNumbers)}";
            await _repository.SaveAuditLogAsync("KFHOnline", "0.0.0.0", "KFHOnline", auditDesc, entityType: "Customer", entityId: customerRim);

            return Ok(responseData);
        }
        catch (Exception ex)
        {
            logEntry.StatusCode = "FAILED";
            logEntry.FailureReason = $"Unhandled exception: {ex.Message}";
            await _repository.LogKFHOnlineTransactionAsync(logEntry);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 2. CUSTOMER TRANSACTION - SELL GOLD
    // =========================================================================
    /// <summary>
    /// Customer initiates a SELL transaction to sell gold back
    /// </summary>
    [AllowAnonymous]
    [HttpPost("transactions/sell")]
    public async Task<IActionResult> SellGold([FromBody] CustomerSellRequest req)
    {
        var logEntry = new KFHOnlineTransactionLog
        {
            TransactionType = "SELL",
            CustomerId = int.TryParse(req.CustomerId, out var cid) ? cid : 0,
            CustomerName = req.CustomerName ?? "Unknown",
            WeightGrams = req.WeightGrams,
            SerialsJson = req.SerialNumbers != null ? JsonSerializer.Serialize(req.SerialNumbers) : null,
            Purity = req.Purity,
            Denomination = req.Denomination,
            Notes = req.Notes,
            RequestJson = JsonSerializer.Serialize(req),
            StatusCode = "PENDING"
        };

        if (!ModelState.IsValid)
        {
            var errors = ModelState.Values.SelectMany(v => v.Errors).Select(e => e.ErrorMessage).ToList();
            logEntry.StatusCode = "FAILED";
            logEntry.FailureReason = string.Join("; ", errors);
            await _repository.LogKFHOnlineTransactionAsync(logEntry);
            return BadRequest(ModelState);
        }

        try
        {
            if (req.SerialNumbers == null || req.SerialNumbers.Count == 0)
            {
                logEntry.StatusCode = "FAILED";
                logEntry.FailureReason = "No bars selected for sale";
                await _repository.LogKFHOnlineTransactionAsync(logEntry);
                return BadRequest(new { error = "No bars selected for sale" });
            }

            // Get current gold price
            var (bidPrice, askPrice, source) = await _rateFeed.GetLiveRatesAsync("GOLD");
            var pricePerGram = bidPrice;

            // Get the bars by serial numbers
            var bars = new List<InventoryItem>();
            foreach (var serial in req.SerialNumbers)
            {
                var bar = await _repository.GetItemBySerialNumberAsync(serial);
                if (bar == null)
                {
                    logEntry.StatusCode = "FAILED";
                    logEntry.FailureReason = $"Bar {serial} not found";
                    logEntry.PricePerGram = pricePerGram;
                    await _repository.LogKFHOnlineTransactionAsync(logEntry);
                    return NotFound(new { error = $"Bar {serial} not found" });
                }
                if (bar.StatusCode != "CUSTOMER_CUSTODY")
                {
                    logEntry.StatusCode = "FAILED";
                    logEntry.FailureReason = $"Bar {serial} is not in customer custody (Status: {bar.StatusCode})";
                    logEntry.PricePerGram = pricePerGram;
                    await _repository.LogKFHOnlineTransactionAsync(logEntry);
                    return BadRequest(new { error = $"Bar {serial} is not in your custody (cannot sell)" });
                }
                bars.Add(bar);
            }

            // Mark bars as READY again (back to vault inventory) and remove holdings
            string customerRim = req.CustomerId ?? "0";
            if (string.IsNullOrWhiteSpace(customerRim))
            {
                logEntry.StatusCode = "FAILED";
                logEntry.FailureReason = "Invalid customer ID";
                logEntry.PricePerGram = pricePerGram;
                await _repository.LogKFHOnlineTransactionAsync(logEntry);
                return BadRequest(new { error = "Invalid customer ID" });
            }

            var itemIds = bars.Select(b => b.ItemId).ToList();

            // Save sale to PMIMS (revert status + remove holdings)
            bool saved = await _repository.SellBarsAsync(customerRim, itemIds);
            if (!saved)
            {
                logEntry.StatusCode = "FAILED";
                logEntry.FailureReason = "Database save failed";
                logEntry.PricePerGram = pricePerGram;
                logEntry.TotalAmount = req.WeightGrams * pricePerGram;
                await _repository.LogKFHOnlineTransactionAsync(logEntry);
                return StatusCode(500, new { error = "Failed to save sale to database" });
            }

            // Log successful transaction
            var totalPayout = req.WeightGrams * pricePerGram;
            logEntry.StatusCode = "CONFIRMED";
            logEntry.PricePerGram = pricePerGram;
            logEntry.TotalAmount = totalPayout;
            var responseData = new
            {
                success = true,
                transactionId = new Random().Next(10000, 99999),
                customerId = req.CustomerId,
                amount = totalPayout,
                weight = req.WeightGrams,
                pricePerGram = pricePerGram,
                barsSold = req.SerialNumbers.Count,
                status = "CONFIRMED",
                message = $"✓ Sale confirmed! You sold {req.WeightGrams}g across {req.SerialNumbers.Count} bar(s) at ${pricePerGram}/g = ${totalPayout:F2}\n\nBars returned to vault inventory and marked as READY.",
                soldBars = req.SerialNumbers.Select(sn => new
                {
                    serialNumber = sn,
                    payout = req.WeightGrams / req.SerialNumbers.Count * pricePerGram
                }).ToList()
            };
            logEntry.ResponseJson = JsonSerializer.Serialize(responseData);
            await _repository.LogKFHOnlineTransactionAsync(logEntry);

            // Also log to PMIMS Audit Trail (system-wide)
            var auditDesc = $"CUSTOMER_SELL: Customer {customerRim} ({req.CustomerName}) sold {req.WeightGrams}g gold back, payout: ${totalPayout:F2}, serial(s): {string.Join(", ", req.SerialNumbers)}";
            await _repository.SaveAuditLogAsync("KFHOnline", "0.0.0.0", "KFHOnline", auditDesc, entityType: "Customer", entityId: customerRim);

            return Ok(responseData);
        }
        catch (Exception ex)
        {
            logEntry.StatusCode = "FAILED";
            logEntry.FailureReason = $"Unhandled exception: {ex.Message}";
            await _repository.LogKFHOnlineTransactionAsync(logEntry);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 3. DELIVERY REQUEST - REQUEST PHYSICAL DELIVERY
    // =========================================================================
    /// <summary>
    /// Customer requests delivery of purchased gold to their address
    /// </summary>
    [AllowAnonymous]
    [HttpPost("delivery/request")]
    public IActionResult RequestDelivery([FromBody] DeliveryRequestDto req)
    {
        if (!ModelState.IsValid)
            return BadRequest(ModelState);

        try
        {
            var delivery = new DeliveryRequest
            {
                TransactionId = req.TransactionId,
                CustomerId = req.CustomerId,
                Status = "PENDING",
                DeliveryAddress = req.DeliveryAddress,
                DeliveryCity = req.DeliveryCity,
                DeliveryCountry = req.DeliveryCountry,
                ContactPhone = req.ContactPhone,
                ShippingFee = req.ShippingFee,
                Notes = req.Notes
            };

            // In a real system, save to DB
            // var savedDelivery = await _repository.SaveDeliveryRequestAsync(delivery);

            return Ok(new
            {
                success = true,
                deliveryId = 1, // Would be from DB
                transactionId = req.TransactionId,
                customerId = req.CustomerId,
                status = "PENDING",
                shippingFee = req.ShippingFee,
                deliveryAddress = req.DeliveryAddress,
                message = "Delivery request submitted. We will process your request within 24 hours."
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 4. GET TRANSACTION HISTORY
    // =========================================================================
    /// <summary>
    /// Retrieve customer's transaction history with gold details
    /// </summary>
    [AllowAnonymous]
    [HttpGet("transactions/{customerId}")]
    public IActionResult GetTransactionHistory(string customerId)
    {
        try
        {
            // In a real system, fetch from DB
            // var transactions = await _repository.GetCustomerTransactionsAsync(customerId);

            // Mock response for now
            return Ok(new
            {
                customerId = customerId,
                transactions = new[]
                {
                    new
                    {
                        transactionId = 1,
                        type = "BUY",
                        weight = 100,
                        amount = 6500,
                        pricePerGram = 65,
                        purity = "99.99%",
                        status = "COMPLETED",
                        createdAt = DateTime.UtcNow.AddDays(-5),
                        goldDetails = new[]
                        {
                            new { serialNumber = "AUG-2024-001-A", weight = 100, denomination = "1000g" }
                        }
                    }
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 5. GET CURRENT GOLD PRICE
    // =========================================================================
    /// <summary>
    /// Get current gold price per gram (used for buy/sell forms)
    /// </summary>
    [AllowAnonymous]
    [HttpGet("prices/gold")]
    public async Task<IActionResult> GetGoldPrice()
    {
        try
        {
            var (bidPrice, askPrice, source) = await _rateFeed.GetLiveRatesAsync("GOLD");
            // Return the bid price (what we pay customers for selling gold)
            return Ok(new
            {
                metal = "GOLD",
                pricePerGram = bidPrice,
                bidPrice = bidPrice,
                askPrice = askPrice,
                source = source,
                currency = "USD",
                lastUpdated = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 6. GET TRANSACTION DETAILS
    // =========================================================================
    /// <summary>
    /// Get detailed information about a specific transaction
    /// </summary>
    [AllowAnonymous]
    [HttpGet("transactions/details/{transactionId}")]
    public IActionResult GetTransactionDetails(int transactionId)
    {
        try
        {
            // In a real system, fetch from DB
            // var transaction = await _repository.GetCustomerTransactionAsync(transactionId);

            return Ok(new
            {
                transactionId = transactionId,
                customerId = "CUST-001",
                customerName = "Ahmed Al-Sabah",
                customerEmail = "ahmed@example.com",
                type = "BUY",
                weight = 100,
                amount = 6500,
                pricePerGram = 65,
                purity = "99.99%",
                metalType = "GOLD",
                status = "COMPLETED",
                createdAt = DateTime.UtcNow.AddDays(-5),
                completedAt = DateTime.UtcNow.AddDays(-4),
                goldDetails = new[]
                {
                    new
                    {
                        goldDetailId = 1,
                        serialNumber = "AUG-2024-001-A",
                        weight = 100,
                        purity = "99.99%",
                        denomination = "1000g",
                        vaultLocation = "ZONE-A / SHELF-1 / SLOT-5",
                        pmims_reference = "INV-2024-00001"
                    }
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 7. GET DELIVERY STATUS
    // =========================================================================
    /// <summary>
    /// Check delivery status for a transaction
    /// </summary>
    [AllowAnonymous]
    [HttpGet("delivery/{transactionId}")]
    public IActionResult GetDeliveryStatus(int transactionId)
    {
        try
        {
            return Ok(new
            {
                transactionId = transactionId,
                deliveryId = 1,
                status = "PENDING",
                deliveryAddress = "P.O. Box 1234, Kuwait City, 13001",
                deliveryCity = "Kuwait City",
                deliveryCountry = "Kuwait",
                contactPhone = "+965 1234 5678",
                shippingFee = 50,
                requestedAt = DateTime.UtcNow.AddDays(-5),
                estimatedDelivery = DateTime.UtcNow.AddDays(7),
                message = "Your delivery is being processed. Estimated delivery: 7 business days."
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

// =========================================================================
// REQUEST/RESPONSE DTOs
// =========================================================================

public class CustomerBuyRequest
{
    public string CustomerId { get; set; } = null!;
    public string CustomerName { get; set; } = null!;
    public decimal WeightGrams { get; set; }
    public List<string>? SerialNumbers { get; set; }
    public string? Purity { get; set; }
    public string? Notes { get; set; }
}

public class CustomerSellRequest
{
    public string CustomerId { get; set; } = null!;
    public string CustomerName { get; set; } = null!;
    public decimal WeightGrams { get; set; }
    public List<string>? SerialNumbers { get; set; }
    public string? Purity { get; set; }
    public string? Denomination { get; set; }
    public string? Notes { get; set; }
}

public class DeliveryRequestDto
{
    public int TransactionId { get; set; }
    public string CustomerId { get; set; } = null!;
    public string DeliveryAddress { get; set; } = null!;
    public string DeliveryCity { get; set; } = null!;
    public string DeliveryCountry { get; set; } = null!;
    public string ContactPhone { get; set; } = null!;
    public decimal ShippingFee { get; set; }
    public string? Notes { get; set; }
}

public class CustomerGiftTransferRequest
{
    public string SenderCustomerId { get; set; } = null!;
    public string SenderCustomerName { get; set; } = null!;
    public string RecipientCustomerId { get; set; } = null!;
    public string RecipientCustomerName { get; set; } = null!;
    public List<int> ItemIds { get; set; } = new();
    public string Occasion { get; set; } = "Gift";
    public string GiftMessage { get; set; } = "";
}
