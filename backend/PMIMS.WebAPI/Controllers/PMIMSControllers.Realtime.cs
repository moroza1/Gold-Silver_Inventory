using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Real-Time Inventory Monitoring -- REST snapshot endpoint
// ------------------------------------------------------------------------
// The frontend calls this once on mount to seed its balances-by-location state,
// then patches it in place from the live "BalanceChanged" / "MovementOccurred"
// events pushed over InventoryMonitoringHub (see PMIMS.WebAPI/Realtime/*). Gated
// by `reports.read`, matching the hub's own policy and every other reporting view.
// =========================================================================
public partial class PMIMSControllers
{
    [Authorize(Policy = "reports.read")]
    [HttpGet("reports/live-balances")]
    public async Task<IActionResult> GetLiveBalances()
    {
        var balances = await _repository.GetAllInventoryBalancesAsync();
        return Ok(balances.Select(b => new
        {
            balance_id = b.BalanceId,
            location_id = b.LocationId,
            location = b.Location?.Description,
            vault_name = b.Location?.Vault?.VaultName,
            branch_name = b.Location?.Branch?.BranchName,
            product_id = b.ProductId,
            metal_name = b.Product?.MetalType?.MetalName,
            denomination = b.Product?.Denomination?.Label,
            ownership_type = b.OwnershipType,
            ready_for_sale_qty = b.ReadyForSaleQty,
            reserved_qty = b.ReservedQty,
            sold_qty = b.SoldQty,
            quarantined_qty = b.QuarantinedQty,
            in_transit_qty = b.InTransitQty,
            last_updated = b.LastUpdated
        }));
    }
}
