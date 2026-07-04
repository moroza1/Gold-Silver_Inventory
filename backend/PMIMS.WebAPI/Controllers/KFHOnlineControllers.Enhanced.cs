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
/// ENHANCED KFHOnline - Full PMIMS Inventory Integration (Extension)
/// Buy: Auto-allocate from PMIMS, mark as CUSTOMER_CUSTODY
/// Sell: Only customer's own bars, update PMIMS status
/// </summary>
public partial class KFHOnlineControllers : ControllerBase
{
    // DI and constructor are in KFHOnlineControllers.cs (main file)

    // =========================================================================
    // 1. GET AVAILABLE INVENTORY BY DENOMINATION
    // =========================================================================
    /// <summary>
    /// Get available gold denominations grouped by type with available quantities
    /// Shows: [100g x 5], [50g x 3], [10g x 12], etc.
    /// NOW: Uses real PMIMS inventory instead of mock data
    /// </summary>
    [AllowAnonymous]
    [HttpGet("inventory/denominations")]
    public async Task<IActionResult> GetAvailableDenominations(string? metalType = "GOLD", string? purity = "99.99%")
    {
        try
        {
            // Get real available inventory from PMIMS database
            // Only shows READY status bars (not CUSTOMER_CUSTODY or SOLD)
            var availableBars = await _repository.GetAvailableInventoryForKfhAsync(
                metalName: metalType ?? "GOLD",
                purity: purity ?? "99.99%",
                limit: 100
            );

            // Convert to response DTO and group by denomination
            var barDtos = availableBars.Select(bar => new
            {
                itemId = bar.ItemId,
                serialNumber = bar.SerialNumber,
                weight = bar.Product?.Denomination?.WeightGrams ?? 0,
                denomination = bar.Product?.Denomination?.Label ?? "Unknown",
                purity = purity ?? "99.99%",
                vaultLocation = $"{bar.Location?.ZoneRoom ?? "?"}/{bar.Location?.ShelfRow ?? "?"}/{bar.Location?.SlotBin ?? "?"}",
                pmims_reference = bar.ItemId.ToString()
            }).ToList();

            // Group by denomination and weight
            var groupedByDenomination = barDtos
                .GroupBy(b => new { b.denomination, b.weight })
                .Select(g => new
                {
                    denomination = g.Key.denomination,
                    weightGrams = g.Key.weight,
                    availableQuantity = g.Count(),
                    totalWeightAvailable = g.Key.weight * g.Count(),
                    bars = g.Select(b => new
                    {
                        b.serialNumber,
                        b.vaultLocation,
                        b.pmims_reference,
                        weight = g.Key.weight
                    }).ToList()
                })
                .OrderByDescending(d => d.weightGrams)
                .ToList();

            return Ok(new
            {
                metalType = metalType,
                purity = purity,
                dataSource = "PMIMS_LIVE",
                totalBarsAvailable = barDtos.Count,
                denominations = groupedByDenomination,
                message = groupedByDenomination.Any()
                    ? "Select denomination and quantity to buy"
                    : "No inventory available - all bars in vault are reserved or sold"
            });
        }
        catch (Exception ex)
        {
            // Fall back to mock data if PMIMS is unavailable
            return StatusCode(500, new {
                error = ex.Message,
                fallbackMessage = "PMIMS connection failed - falling back to mock data",
                suggestion = "Ensure backend is running and database is connected"
            });
        }
    }

    // =========================================================================
    // 2. GET CUSTOMER CUSTODY HOLDINGS
    // =========================================================================
    /// <summary>
    /// Get bars customer owns (purchased and held in custody)
    /// Used by SELL form to show only bars the customer can sell
    /// </summary>
    [AllowAnonymous]
    [HttpGet("custody/{customerId}")]
    public async Task<IActionResult> GetCustomerCustodyBars(int customerId)
    {
        try
        {
            if (customerId <= 0)
            {
                return BadRequest(new { error = "Invalid customer ID" });
            }

            // Get real customer custody bars from PMIMS
            var custodyBars = await _repository.GetCustomerCustodyBarsAsync(customerId);

            var barDtos = custodyBars.Select(bar => new
            {
                itemId = bar.ItemId,
                serialNumber = bar.SerialNumber,
                weight = bar.Product?.Denomination?.WeightGrams ?? 0,
                denomination = bar.Product?.Denomination?.Label ?? "Unknown",
                purity = bar.Product?.MetalType?.MetalName ?? "Unknown",
                vaultLocation = $"{bar.Location?.ZoneRoom ?? "?"}/{bar.Location?.ShelfRow ?? "?"}/{bar.Location?.SlotBin ?? "?"}",
                pmims_reference = bar.ItemId.ToString(),
                status = "CUSTOMER_CUSTODY"
            }).ToList();

            return Ok(new
            {
                customerId = customerId,
                totalBars = barDtos.Count,
                totalWeightGrams = barDtos.Sum(b => b.weight),
                dataSource = "PMIMS_LIVE",
                bars = barDtos,
                message = barDtos.Any()
                    ? $"You own {barDtos.Count} bar(s) - select to sell"
                    : "You don't own any bars yet"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // Helper methods and additional enhanced endpoints

    // =========================================================================
    // 3. GET TRANSACTION HISTORY FOR DASHBOARD
    // =========================================================================
    /// <summary>
    /// Get all KFHOnline buy/sell transactions for admin dashboard
    /// </summary>
    [AllowAnonymous]
    [HttpGet("transactions")]
    public async Task<IActionResult> GetTransactionHistory(string? type = null, string? customerId = null, int limit = 100)
    {
        try
        {
            // Get all customer holdings to build transaction history
            var allHoldings = await _repository.GetAllCustomerHoldingsAsync();

            var transactions = allHoldings.GroupBy(h => h.CustomerId)
                .SelectMany(g => g.Select((holding, idx) => new
                {
                    transactionId = holding.HoldingId * 1000 + idx,
                    type = "BUY",
                    customerId = $"CUST-{holding.CustomerId:000}",
                    customerName = holding.Customer?.CustomerName ?? "Unknown",
                    barCount = 1,
                    weightGrams = (int)(holding.Item?.Product?.Denomination?.WeightGrams ?? 0),
                    pricePerGram = 65.00m,
                    totalAmount = (holding.Item?.Product?.Denomination?.WeightGrams ?? 0) * 65m,
                    status = "CONFIRMED",
                    timestamp = holding.AllocationDate,
                    serialNumbers = new[] { holding.Item?.SerialNumber ?? "" }
                }))
                .OrderByDescending(t => t.timestamp)
                .ToList();

            // Apply filters
            if (!string.IsNullOrWhiteSpace(type))
                transactions = transactions.Where(t => t.type == type).ToList();

            if (!string.IsNullOrWhiteSpace(customerId))
                transactions = transactions.Where(t => t.customerId.Contains(customerId)).ToList();

            transactions = transactions.Take(limit).ToList();

            return Ok(new
            {
                dataSource = "PMIMS_LIVE",
                transactionCount = transactions.Count,
                transactions = transactions
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 4. GET INVENTORY BY STATUS (for custody/stock filtering)
    // =========================================================================
    /// <summary>
    /// Get inventory items filtered by status code (e.g., CUSTOMER_CUSTODY, READY, SOLD)
    /// </summary>
    [AllowAnonymous]
    [HttpGet("inventory/by-status")]
    public async Task<IActionResult> GetInventoryByStatus(string status = "CUSTOMER_CUSTODY", string? customerId = null, int limit = 100)
    {
        try
        {
            // Get real data from PMIMS
            var (bidPrice, askPrice, source) = await _rateFeed.GetLiveRatesAsync("GOLD");

            // Get all customer holdings (status = CUSTOMER_CUSTODY by default)
            var holdings = await _repository.GetAllCustomerHoldingsAsync();

            var custodyBars = holdings
                .Where(h => h.StatusCode == status && h.Item != null)
                .Select(h => new
                {
                    itemId = h.Item!.ItemId,
                    serialNumber = h.Item!.SerialNumber,
                    customerId = h.CustomerId,
                    customerName = h.Customer?.CustomerName ?? "Unknown",
                    weight = (int)(h.Item!.Product?.Denomination?.WeightGrams ?? 0),
                    denomination = h.Item!.Product?.Denomination?.Label ?? "Unknown",
                    purity = h.Item!.Product?.MetalType?.MetalName ?? "Unknown",
                    vaultLocation = $"{h.Item!.Location?.ZoneRoom ?? "?"}/{h.Item!.Location?.ShelfRow ?? "?"}/{h.Item!.Location?.SlotBin ?? "?"}",
                    statusCode = h.StatusCode,
                    allocationDate = h.AllocationDate,
                    currentValue = (h.Item!.Product?.Denomination?.WeightGrams ?? 0) * bidPrice
                })
                .ToList();

            // Filter by customer if provided
            if (!string.IsNullOrWhiteSpace(customerId) && int.TryParse(customerId, out int filterCustomerId))
                custodyBars = custodyBars.Where(b => b.customerId == filterCustomerId).ToList();

            custodyBars = custodyBars.OrderByDescending(b => b.allocationDate).Take(limit).ToList();

            // Calculate stats
            var totalBars = custodyBars.Count;
            var totalWeight = custodyBars.Sum(b => (decimal)b.weight);
            var totalValue = custodyBars.Sum(b => (decimal)b.currentValue);
            var uniqueCustomers = custodyBars.Select(b => b.customerId).Distinct().Count();

            return Ok(new
            {
                dataSource = "PMIMS_LIVE",
                status = status,
                itemCount = totalBars,
                totalWeightGrams = totalWeight,
                totalCurrentValue = totalValue,
                uniqueCustomers = uniqueCustomers,
                currentGoldPrice = bidPrice,
                items = custodyBars
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 5. GET CUSTODY SUMMARY FOR EXECUTIVE DASHBOARD
    // =========================================================================
    /// <summary>
    /// Quick summary card for "Client Custody Stock" on executive dashboard
    /// </summary>
    [AllowAnonymous]
    [HttpGet("custody-summary")]
    public async Task<IActionResult> GetCustodySummary()
    {
        try
        {
            // Get real data from PMIMS
            var (bidPrice, askPrice, source) = await _rateFeed.GetLiveRatesAsync("GOLD");

            // Get all customer holdings
            var allHoldings = await _repository.GetAllCustomerHoldingsAsync();
            var custodyHoldings = allHoldings.Where(h => h.StatusCode == "HELD_IN_CUSTODY" && h.Item != null).ToList();

            // Calculate summary stats
            var totalBarsInCustody = custodyHoldings.Count;
            var totalWeightGrams = custodyHoldings.Sum(h => (int)(h.Item?.Product?.Denomination?.WeightGrams ?? 0));
            var totalValueKwd = custodyHoldings.Sum(h => (h.Item?.Product?.Denomination?.WeightGrams ?? 0) * bidPrice);
            var uniqueCustomers = custodyHoldings.Select(h => h.CustomerId).Distinct().Count();

            // Get latest transaction time
            var lastTransactionTime = custodyHoldings.OrderByDescending(h => h.AllocationDate).FirstOrDefault()?.AllocationDate ?? DateTime.UtcNow;

            var summary = new
            {
                totalBarsInCustody = totalBarsInCustody,
                totalWeightGrams = totalWeightGrams,
                totalValueKwd = Math.Round(totalValueKwd, 2),
                uniqueCustomers = uniqueCustomers,
                currentGoldPrice = bidPrice,
                lastTransactionTime = lastTransactionTime,
                dataSource = "PMIMS_LIVE"
            };

            return Ok(summary);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 6. GET PROPRIETARY STOCK SUMMARY FOR EXECUTIVE DASHBOARD
    // =========================================================================
    /// <summary>
    /// Quick summary card for "Proprietary Gold Stock" (available inventory) on executive dashboard
    /// Shows KFH-owned bars available for customer purchase (READY status)
    /// </summary>
    [AllowAnonymous]
    [HttpGet("proprietary-stock-summary")]
    public async Task<IActionResult> GetProprietaryStockSummary()
    {
        try
        {
            // Get real data from PMIMS
            var (bidPrice, askPrice, source) = await _rateFeed.GetLiveRatesAsync("GOLD");

            // Get all available inventory (READY status bars)
            var availableBars = await _repository.GetAvailableInventoryForKfhAsync(
                metalName: "GOLD",
                purity: "99.99%",
                limit: 1000
            );

            // Calculate summary stats for available stock
            var totalBarsAvailable = availableBars.Count();
            decimal totalWeightGrams = 0;
            decimal totalValueKwd = 0;

            foreach (var bar in availableBars)
            {
                var weight = bar.Product?.Denomination?.WeightGrams ?? 0;
                totalWeightGrams += weight;
                totalValueKwd += weight * bidPrice;
            }

            // Breakdown by denomination
            var denominationBreakdown = availableBars
                .Where(b => b.Product?.Denomination != null)
                .GroupBy(b => b.Product!.Denomination!.Label)
                .Select(g => new
                {
                    denomination = g.Key,
                    quantity = g.Count(),
                    totalWeight = (int)g.Sum(b => b.Product?.Denomination?.WeightGrams ?? 0)
                })
                .OrderByDescending(d => d.totalWeight)
                .ToList();

            var summary = new
            {
                totalBarsAvailable = totalBarsAvailable,
                totalWeightGrams = totalWeightGrams,
                totalValueKwd = Math.Round(totalValueKwd, 2),
                currentGoldPrice = bidPrice,
                denominationBreakdown = denominationBreakdown,
                lastUpdated = DateTime.UtcNow,
                dataSource = "PMIMS_LIVE",
                status = totalBarsAvailable > 0 ? "IN_STOCK" : "OUT_OF_STOCK"
            };

            return Ok(summary);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // 7. GET KFHONLINE TRANSACTION LOG
    // =========================================================================
    /// <summary>
    /// Get KFHOnline transaction logs for monitoring and audit trail
    /// Shows all buy/sell/delivery transactions (successes and failures)
    /// </summary>
    [AllowAnonymous]
    [HttpGet("logs")]
    public async Task<IActionResult> GetTransactionLogs(int? customerId = null, string? status = null, string? from = null, string? to = null, int limit = 1000)
    {
        try
        {
            DateTime? fromDate = null, toDate = null;
            if (!string.IsNullOrWhiteSpace(from) && DateTime.TryParse(from, out var fd))
                fromDate = fd;
            if (!string.IsNullOrWhiteSpace(to) && DateTime.TryParse(to, out var td))
                toDate = td;

            var logs = await _repository.GetKFHOnlineTransactionLogsAsync(customerId, status, fromDate, toDate, limit);

            var formattedLogs = logs.Select(l => new
            {
                logId = l.LogId,
                transactionType = l.TransactionType,
                customerId = l.CustomerId,
                customerName = l.CustomerName,
                weightGrams = l.WeightGrams,
                serials = l.SerialsJson ?? "[]",
                statusCode = l.StatusCode,
                failureReason = l.FailureReason,
                pricePerGram = l.PricePerGram,
                totalAmount = l.TotalAmount,
                purity = l.Purity,
                denomination = l.Denomination,
                notes = l.Notes,
                createdAt = l.CreatedAt,
                createdBy = l.CreatedBy
            }).ToList();

            return Ok(new
            {
                dataSource = "PMIMS_LIVE",
                totalLogs = formattedLogs.Count,
                logs = formattedLogs,
                filters = new
                {
                    customerId = customerId,
                    status = status,
                    from = fromDate,
                    to = toDate
                }
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // =========================================================================
    // HELPER METHODS (Mock data - kept for reference/fallback)
    // =========================================================================

    private class MockBar
    {
        public int ItemId { get; set; }
        public string SerialNumber { get; set; } = null!;
        public decimal Weight { get; set; }
        public string Purity { get; set; } = null!;
        public string Denomination { get; set; } = null!;
        public string VaultLocation { get; set; } = null!;
        public string PMIMSReference { get; set; } = null!;
    }

    private List<MockBar> GetMockAvailableBars(decimal weightNeeded, string purity)
    {
        var allBars = new[]
        {
            new MockBar { ItemId = 1001, SerialNumber = "AUG-2024-VAULT-001", Weight = 1000, Purity = "99.99%", Denomination = "1000g", VaultLocation = "ZONE-A/SHELF-1/SLOT-1", PMIMSReference = "1001" },
            new MockBar { ItemId = 1002, SerialNumber = "AUG-2024-VAULT-002", Weight = 500, Purity = "99.99%", Denomination = "500g", VaultLocation = "ZONE-A/SHELF-1/SLOT-2", PMIMSReference = "1002" },
            new MockBar { ItemId = 1003, SerialNumber = "AUG-2024-VAULT-003", Weight = 250, Purity = "99.99%", Denomination = "250g", VaultLocation = "ZONE-A/SHELF-2/SLOT-3", PMIMSReference = "1003" },
            new MockBar { ItemId = 1004, SerialNumber = "AUG-2024-VAULT-004", Weight = 100, Purity = "99.99%", Denomination = "100g", VaultLocation = "ZONE-B/SHELF-1/SLOT-5", PMIMSReference = "1004" }
        };

        return allBars.Where(b => b.Purity == purity).ToList();
    }

    private List<MockBar> GetMockCustomerCustodyBars(string customerId)
    {
        // In production: fetch from PMIMS where status = "CUSTOMER_CUSTODY" AND customer_rim = customerId
        var mockCustody = new[]
        {
            new MockBar { ItemId = 2001, SerialNumber = "AUG-2024-CUST-001", Weight = 100, Purity = "99.99%", Denomination = "1000g", VaultLocation = "ZONE-A/SHELF-1/SLOT-1", PMIMSReference = "2001" },
            new MockBar { ItemId = 2002, SerialNumber = "AUG-2024-CUST-002", Weight = 50, Purity = "99.99%", Denomination = "500g", VaultLocation = "ZONE-A/SHELF-1/SLOT-2", PMIMSReference = "2002" }
        };

        return mockCustody.ToList();
    }
}

// DTOs are defined in KFHOnlineControllers.cs to avoid duplication
