using Ledger.Gl.Core;

namespace Ledger.Gl.Integration;

// ============================================================================
// INTEGRATION LAYER (kept separate from Core on purpose).
// ----------------------------------------------------------------------------
// The listener is the boundary between "the inventory system" and "the GL". The
// inventory system raises whatever domain events it already has; an IEventSource
// implementation translates each one into a standardized InventoryEvent and this
// listener posts it. Core has ZERO knowledge of the inventory schema; all the
// coupling lives here, in adapters you write per host system.
//
// Wiring pattern (three lines in your inventory service):
//   var gl = GeneralLedger.FromConfigFile("Config/gl-accounts.gold-silver.json");
//   var listener = new InventoryEventListener(gl);
//   await listener.HandleAsync(myAdapter.ToInventoryEvent(inventoryTransaction));
// ============================================================================

/// <summary>
/// Anything that can turn a host-specific inventory record of type
/// <typeparamref name="TSource"/> into the standardized contract. Implement one
/// of these per inventory record shape you want to post (see PmimsInventoryAdapter).
/// </summary>
public interface IInventoryEventAdapter<in TSource>
{
    /// <summary>Return the GL event, or null if this record should NOT hit the GL.</summary>
    InventoryEvent? ToInventoryEvent(TSource source);
}

/// <summary>
/// Consumes inventory events and posts them to the ledger. Thin on purpose --
/// its value is being the single, testable choke point where inventory activity
/// becomes GL activity, with optional hooks for logging/monitoring.
/// </summary>
public sealed class InventoryEventListener
{
    private readonly GeneralLedger _gl;
    private readonly Action<PostResult>? _onPosted;
    private readonly Action<InventoryEvent, Exception>? _onError;

    public InventoryEventListener(
        GeneralLedger gl,
        Action<PostResult>? onPosted = null,
        Action<InventoryEvent, Exception>? onError = null)
    {
        _gl = gl;
        _onPosted = onPosted;
        _onError = onError;
    }

    /// <summary>Post a pre-built standardized event.</summary>
    public async Task<PostResult> HandleAsync(InventoryEvent e, CancellationToken ct = default)
    {
        try
        {
            var result = await _gl.PostAsync(e, ct);
            _onPosted?.Invoke(result);
            return result;
        }
        catch (Exception ex) when (_onError is not null)
        {
            _onError(e, ex);
            throw;
        }
    }

    /// <summary>Adapt a host-specific record and post it. Returns null if the adapter skipped it.</summary>
    public async Task<PostResult?> HandleAsync<TSource>(
        TSource source, IInventoryEventAdapter<TSource> adapter, CancellationToken ct = default)
    {
        var e = adapter.ToInventoryEvent(source);
        if (e is null) return null; // adapter decided this record is GL-irrelevant (e.g. a pure reservation)
        return await HandleAsync(e, ct);
    }
}
