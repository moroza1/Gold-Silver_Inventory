using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Gold Dispensing Machine (GDM) Integration -- scalability hook
// ------------------------------------------------------------------------
// Segregation mirrors the vault_location / spatial_map split (see AGENTS.md
// section 4): registering/decommissioning a physical machine is an
// administrative act (`device_integration`), while viewing/operating dispense
// transactions against an already-registered machine is operational
// (`dispensing`). A physical GDM vendor integration is expected to:
//   1. Be registered once via POST /api/admin/devices (device_integration.write).
//   2. Call POST /api/dispensing/request when a customer selects a product,
//      which allocates one available serialized bar from the machine's own
//      cassette location.
//   3. Call POST /api/dispensing/{id}/complete once the bar has physically
//      left the machine, or POST /api/dispensing/{id}/fail to release the
//      allocation back to available stock (e.g. a jam).
// Every step reuses existing inventory/balance/audit/chain-of-custody
// machinery -- see IInventoryRepository.RequestDispenseAsync /
// CompleteDispenseAsync / FailDispenseAsync (PMIMS.Infrastructure/
// InventoryRepository.cs) -- so this is additive, not a core rework.
//
// NOTE (see gap-analysis doc): these endpoints are still gated by the same
// user-JWT policies as the rest of the API. A real machine-to-machine
// integration will need its own credential type (API key / mTLS client cert)
// distinct from a human operator's JWT -- flagged as a follow-up, out of
// scope for this pass.
// =========================================================================
public partial class PMIMSControllers
{
    // -- Device registration (admin/governance tier) --

    [Authorize(Policy = "device_integration.read")]
    [HttpGet("admin/devices")]
    public async Task<IActionResult> GetDispensingDevices()
    {
        var devices = await _repository.GetDispensingDevicesAsync();
        return Ok(devices.Select(d => new
        {
            device_id = d.DeviceId,
            device_code = d.DeviceCode,
            device_name = d.DeviceName,
            location_id = d.LocationId,
            location = d.Location?.Description,
            branch_id = d.BranchId,
            branch_name = d.Branch?.BranchName,
            manufacturer = d.Manufacturer,
            model = d.Model,
            api_endpoint = d.ApiEndpoint,
            status_code = d.StatusCode,
            last_heartbeat_at = d.LastHeartbeatAt,
            is_active = d.IsActive,
            registered_at = d.RegisteredAt
        }));
    }

    [Authorize(Policy = "device_integration.write")]
    [HttpPost("admin/devices")]
    public async Task<IActionResult> SaveDispensingDevice([FromBody] SaveDeviceRequest req)
    {
        try
        {
            var device = await _repository.SaveDispensingDeviceAsync(new DispensingDevice
            {
                DeviceId = req.DeviceId ?? 0,
                DeviceCode = req.DeviceCode,
                DeviceName = req.DeviceName,
                LocationId = req.LocationId,
                BranchId = req.BranchId,
                Manufacturer = req.Manufacturer,
                Model = req.Model,
                ApiEndpoint = req.ApiEndpoint,
                StatusCode = req.StatusCode ?? "OFFLINE",
                IsActive = req.IsActive,
                RegisteredBy = req.RegisteredBy ?? "SYSTEM"
            });
            return Ok(new { device_id = device.DeviceId, device_code = device.DeviceCode, message = "Device saved successfully." });
        }
        catch (System.Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [Authorize(Policy = "device_integration.write")]
    [HttpDelete("admin/devices/{id}")]
    public async Task<IActionResult> DeleteDispensingDevice(int id)
    {
        var result = await _repository.DeleteDispensingDeviceAsync(id);
        if (!result) return BadRequest(new { error = "Device not found, or has a dispense transaction in flight." });
        return Ok(new { message = "Device removed successfully." });
    }

    [Authorize(Policy = "dispensing.write")]
    [HttpPost("admin/devices/{id}/heartbeat")]
    public async Task<IActionResult> DeviceHeartbeat(int id, [FromBody] DeviceHeartbeatRequest req)
    {
        var device = await _repository.RecordDeviceHeartbeatAsync(id, req.StatusCode);
        if (device == null) return NotFound();
        return Ok(new { device_id = device.DeviceId, status_code = device.StatusCode, last_heartbeat_at = device.LastHeartbeatAt });
    }

    // -- Dispense operations (operational tier) --

    [Authorize(Policy = "dispensing.read")]
    [HttpGet("dispensing/transactions")]
    public async Task<IActionResult> GetDispenseTransactions([FromQuery] int? deviceId = null)
    {
        var txns = await _repository.GetDispenseTransactionsAsync(deviceId);
        return Ok(txns.Select(t => new
        {
            dispense_id = t.DispenseId,
            device_id = t.DeviceId,
            device_code = t.Device?.DeviceCode,
            product_id = t.ProductId,
            product_label = t.Product?.Denomination?.Label,
            item_id = t.ItemId,
            serial_number = t.Item?.SerialNumber,
            customer_id = t.CustomerId,
            channel_name = t.Channel?.ChannelName,
            status_code = t.StatusCode,
            requested_at = t.RequestedAt,
            dispensed_at = t.DispensedAt,
            failure_reason = t.FailureReason
        }));
    }

    [Authorize(Policy = "dispensing.write")]
    [HttpPost("dispensing/request")]
    public async Task<IActionResult> RequestDispense([FromBody] RequestDispenseRequest req)
    {
        var (txn, result) = await _repository.RequestDispenseAsync(req.DeviceId, req.ProductId, req.CustomerId, req.ChannelId, req.IdempotencyKey, req.InitiatedBy);

        if (result == "DEVICE_NOT_FOUND") return NotFound(new { error = "Device not found." });
        if (result == "DEVICE_NOT_ACTIVE") return BadRequest(new { error = "Device is not currently ACTIVE." });
        if (result == "NO_STOCK_AT_DEVICE") return BadRequest(new { error = "No available bar of this product at the device's cassette location." });

        return Ok(new { dispense_id = txn!.DispenseId, item_id = txn.ItemId, status_code = txn.StatusCode, idempotent_replay = result == "IDEMPOTENT_REPLAY" });
    }

    [Authorize(Policy = "dispensing.write")]
    [HttpPost("dispensing/{id}/complete")]
    public async Task<IActionResult> CompleteDispense(int id, [FromBody] CompleteDispenseRequest req)
    {
        var (success, result) = await _repository.CompleteDispenseAsync(id, req.CompletedBy);
        if (!success) return BadRequest(new { error = result });
        return Ok(new { dispense_id = id, message = "Dispense completed and inventory updated." });
    }

    [Authorize(Policy = "dispensing.write")]
    [HttpPost("dispensing/{id}/fail")]
    public async Task<IActionResult> FailDispense(int id, [FromBody] FailDispenseRequest req)
    {
        var success = await _repository.FailDispenseAsync(id, req.Reason);
        if (!success) return BadRequest(new { error = "Dispense not found or not in a failable state." });
        return Ok(new { dispense_id = id, message = "Dispense marked failed; allocation released back to available stock." });
    }
}

public class SaveDeviceRequest
{
    public int? DeviceId { get; set; }
    public string DeviceCode { get; set; } = null!;
    public string DeviceName { get; set; } = null!;
    public int LocationId { get; set; }
    public int BranchId { get; set; }
    public string? Manufacturer { get; set; }
    public string? Model { get; set; }
    public string? ApiEndpoint { get; set; }
    public string? StatusCode { get; set; }
    public bool IsActive { get; set; } = true;
    public string? RegisteredBy { get; set; }
}

public class DeviceHeartbeatRequest { public string StatusCode { get; set; } = "ACTIVE"; }

public class RequestDispenseRequest
{
    public int DeviceId { get; set; }
    public int ProductId { get; set; }
    public int? CustomerId { get; set; }
    public int ChannelId { get; set; }
    public string IdempotencyKey { get; set; } = null!;
    public string InitiatedBy { get; set; } = null!;
}

public class CompleteDispenseRequest { public string CompletedBy { get; set; } = null!; }
public class FailDispenseRequest { public string Reason { get; set; } = null!; }
