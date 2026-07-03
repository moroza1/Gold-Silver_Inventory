using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Realtime;

// Implements the Application-layer IInventoryMonitoringNotifier by broadcasting over
// InventoryMonitoringHub. Registered as Scoped in Program.cs and injected into
// AppDbContext -- see the wiring notes there. Payloads intentionally carry raw IDs
// (location_id, product_id) rather than resolved names: the entities passed in are
// frequently loaded without their navigation properties populated (they come from
// whatever partial Include chain the originating repository call used), so resolving
// display names here would risk stale/incomplete joins. The frontend already holds
// the full locations/products/branches lists in state from its normal fetches and
// resolves IDs to names client-side.
public class SignalRInventoryMonitoringNotifier : IInventoryMonitoringNotifier
{
    private readonly IHubContext<InventoryMonitoringHub> _hub;

    public SignalRInventoryMonitoringNotifier(IHubContext<InventoryMonitoringHub> hub)
    {
        _hub = hub;
    }

    public Task NotifyMovementAsync(InventoryTransaction transaction) =>
        _hub.Clients.All.SendAsync("MovementOccurred", new
        {
            transaction_id = transaction.TransactionId,
            transaction_number = transaction.TransactionNumber,
            item_id = transaction.ItemId,
            transaction_type = transaction.TransactionType,
            source_location_id = transaction.SourceLocationId,
            destination_location_id = transaction.DestinationLocationId,
            source_ownership = transaction.SourceOwnership,
            destination_ownership = transaction.DestinationOwnership,
            initiated_by = transaction.InitiatedBy,
            timestamp = transaction.TransactionTimestamp
        });

    public Task NotifyBalanceChangedAsync(InventoryBalance balance) =>
        _hub.Clients.All.SendAsync("BalanceChanged", new
        {
            location_id = balance.LocationId,
            product_id = balance.ProductId,
            ownership_type = balance.OwnershipType,
            ready_for_sale_qty = balance.ReadyForSaleQty,
            reserved_qty = balance.ReservedQty,
            sold_qty = balance.SoldQty,
            quarantined_qty = balance.QuarantinedQty,
            in_transit_qty = balance.InTransitQty,
            last_updated = balance.LastUpdated
        });
}
