using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace PMIMS.WebAPI.Realtime;

// =========================================================================
// Real-Time Inventory Monitoring Hub
// ------------------------------------------------------------------------
// Live push channel for precious-metal quantity/movement monitoring (to/from
// main vault, between branches, and with customers). This is a read-only
// broadcast channel -- the hub has no client-invokable methods; every event
// is pushed server-side by SignalRInventoryMonitoringNotifier, which is
// itself driven by AppDbContext.SaveChangesAsync (see
// PMIMS.Infrastructure/AppDbContext.cs) whenever an InventoryTransaction is
// created or an InventoryBalance changes -- i.e. every existing movement
// path (intake, branch transfer, withdrawal, sale, GDM dispense,
// reconciliation quarantine) already feeds this without any per-call-site
// instrumentation.
//
// Gated by the same `reports.read` policy as every other reporting/dashboard
// view, since this is a live version of the same underlying data -- no new
// permission module needed. Connect at /hubs/inventory-monitoring.
//
// Client events pushed:
//   "MovementOccurred"  -- one InventoryTransaction row (see
//                          SignalRInventoryMonitoringNotifier.NotifyMovementAsync
//                          for the exact payload shape).
//   "BalanceChanged"    -- one InventoryBalance row, current quantities for a
//                          (location, product, ownership) tuple.
// =========================================================================
[Authorize(Policy = "reports.read")]
public class InventoryMonitoringHub : Hub
{
}
