using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// Automatic Management Email Notifications (RFP item 7)
// New admin-tier `notifications` module -- distribution-list configuration
// is sensitive (who receives inventory/financial data by email), so it's
// segregated the same way `master_data`/`vault_location` are: separate
// from any operational view.
// =========================================================================
public partial class PMIMSControllers
{
    [Authorize(Policy = "notifications.read")]
    [HttpGet("notifications/subscriptions")]
    public async Task<IActionResult> GetNotificationSubscriptions()
    {
        var subs = await _repository.GetNotificationSubscriptionsAsync();
        return Ok(subs.Select(MapSubscription));
    }

    [Authorize(Policy = "notifications.write")]
    [HttpPost("notifications/subscriptions")]
    public async Task<IActionResult> CreateNotificationSubscription([FromBody] SaveNotificationSubscriptionRequest req)
    {
        try
        {
            var sub = await _repository.SaveNotificationSubscriptionAsync(new NotificationSubscription
            {
                DistributionListEmail = req.DistributionListEmail,
                ReportType = req.ReportType,
                ScheduleCron = req.ScheduleCron,
                Format = req.Format ?? "PDF",
                IsActive = true,
                CreatedBy = req.CreatedBy ?? "system-admin"
            });
            return Created($"/api/notifications/subscriptions/{sub.SubscriptionId}", MapSubscription(sub));
        }
        catch (Exception ex) { return BadRequest(new { error = ex.Message }); }
    }

    [Authorize(Policy = "notifications.write")]
    [HttpPut("notifications/subscriptions/{id:int}")]
    public async Task<IActionResult> UpdateNotificationSubscription(int id, [FromBody] SaveNotificationSubscriptionRequest req)
    {
        try
        {
            var sub = await _repository.SaveNotificationSubscriptionAsync(new NotificationSubscription
            {
                SubscriptionId = id,
                DistributionListEmail = req.DistributionListEmail,
                ReportType = req.ReportType,
                ScheduleCron = req.ScheduleCron,
                Format = req.Format ?? "PDF",
                IsActive = req.IsActive
            });
            return Ok(MapSubscription(sub));
        }
        catch (InvalidOperationException) { return NotFound(new { error = "Subscription not found." }); }
    }

    [Authorize(Policy = "notifications.write")]
    [HttpDelete("notifications/subscriptions/{id:int}")]
    public async Task<IActionResult> DeleteNotificationSubscription(int id)
    {
        bool ok = await _repository.DeleteNotificationSubscriptionAsync(id);
        if (!ok) return NotFound(new { error = "Subscription not found." });
        return Ok(new { message = "Subscription deleted." });
    }

    [Authorize(Policy = "notifications.write")]
    [HttpPost("notifications/subscriptions/{id:int}/test-send")]
    public async Task<IActionResult> TestSendNotification(int id)
    {
        var sub = await _repository.GetNotificationSubscriptionByIdAsync(id);
        if (sub == null) return NotFound(new { error = "Subscription not found." });

        var (success, messageId, error) = await _emailSender.SendAsync(
            sub.DistributionListEmail,
            $"KFH PMIMS -- Test Delivery ({sub.ReportType})",
            $"<p>This is a test delivery for notification subscription #{sub.SubscriptionId} ({sub.ReportType}). If you received this, the SMTP configuration is working.</p>");

        await _repository.RecordNotificationDeliveryAsync(new NotificationDelivery
        {
            SubscriptionId = id,
            StatusCode = success ? "SENT" : "FAILED",
            MessageId = messageId,
            FailureReason = error
        });

        if (!success) return BadRequest(new { error = error ?? "Send failed." });
        return Ok(new { message = "Test email sent.", message_id = messageId });
    }

    [Authorize(Policy = "notifications.read")]
    [HttpGet("notifications/deliveries")]
    public async Task<IActionResult> GetNotificationDeliveries([FromQuery] int? subscriptionId)
    {
        var deliveries = await _repository.GetNotificationDeliveriesAsync(subscriptionId);
        return Ok(deliveries.Select(d => new
        {
            delivery_id = d.DeliveryId,
            subscription_id = d.SubscriptionId,
            sent_at = d.SentAt,
            status_code = d.StatusCode,
            message_id = d.MessageId,
            failure_reason = d.FailureReason
        }));
    }

    // Anonymous by design -- standard email-compliance pattern (recipient clicks an unsubscribe
    // link with no PMIMS login). subscriptionId acts as a simple bearer token here; production
    // hardening should replace this with a signed, single-use token (see design doc item 7).
    [AllowAnonymous]
    [HttpGet("notifications/unsubscribe")]
    public async Task<IActionResult> Unsubscribe([FromQuery] int subscriptionId)
    {
        bool ok = await _repository.UnsubscribeAsync(subscriptionId);
        if (!ok) return NotFound(new { error = "Subscription not found." });
        return Content("You have been unsubscribed from this PMIMS report. If this was a mistake, contact IT Administration to re-enable it.", "text/plain");
    }

    // =========================================================================
    // Immediate (event-triggered) customer/management notifications -- fired inline the
    // moment a key event happens, reusing the same subscription/delivery model as the
    // cron-scheduled batch reports above but bypassing NotificationSchedulerService's
    // polling loop entirely. See INotificationDispatchService for the shared send/record
    // logic (used here and by ReconciliationService for INVENTORY_DISCREPANCY).
    // =========================================================================

    // Called after ProcessWorkflowActionAsync returns SUCCESS for an "APPROVED" action --
    // checks whether that action was the *final* approval step of a BRANCH_TRANSFER (the
    // transfer is now genuinely complete, not just advanced one step) and, if so, sends a
    // TRANSFER_COMPLETED notification to any matching active subscription.
    private async Task NotifyIfTransferCompletedAsync(int instanceId)
    {
        var instance = await _repository.GetWorkflowInstanceByIdAsync(instanceId);
        if (instance == null || instance.WorkflowType != "BRANCH_TRANSFER" || instance.StatusCode != "APPROVED")
        {
            return;
        }

        var transfer = await _repository.GetBranchTransferByIdAsync(instance.EntityId);
        if (transfer == null) return;

        string subject = $"KFH PMIMS -- Branch Transfer Completed (#{transfer.TransferId})";
        string body = "<p>A PMIMS branch transfer has been fully approved and completed.</p>" +
            "<ul>" +
            $"<li><b>Transfer #</b>: {transfer.TransferId}</li>" +
            $"<li><b>Serial Number</b>: {transfer.Item?.SerialNumber ?? "Unknown"}</li>" +
            $"<li><b>From Branch</b>: {transfer.SourceBranch?.BranchName ?? "Unknown"}</li>" +
            $"<li><b>To Branch</b>: {transfer.DestinationBranch?.BranchName ?? "Unknown"}</li>" +
            $"<li><b>Courier</b>: {transfer.CourierInfo}</li>" +
            $"<li><b>Approved By</b>: {transfer.ApprovedBy ?? "Unknown"}</li>" +
            "</ul>";

        await _notificationDispatch.DispatchAsync("TRANSFER_COMPLETED", subject, body);
    }

    private static object MapSubscription(NotificationSubscription s) => new
    {
        subscription_id = s.SubscriptionId,
        distribution_list_email = s.DistributionListEmail,
        report_type = s.ReportType,
        schedule_cron = s.ScheduleCron,
        format = s.Format,
        is_active = s.IsActive,
        last_run_at = s.LastRunAt,
        unsubscribed_at = s.UnsubscribedAt,
        created_by = s.CreatedBy,
        created_at = s.CreatedAt
    };
}

public class SaveNotificationSubscriptionRequest
{
    public string DistributionListEmail { get; set; } = null!;
    // INVENTORY_BALANCE | LOW_STOCK | HIGH_VALUE_MOVEMENT are cron-scheduled batch reports
    // (NotificationSchedulerService). TRANSFER_COMPLETED | INVENTORY_DISCREPANCY are
    // event-triggered and fire immediately (see PMIMSControllers.NotifyIfTransferCompletedAsync
    // and ReconciliationService.RunReconciliationAsync) -- ScheduleCron is unused for these two
    // but still required by the schema; any valid cron expression (it is simply never checked).
    public string ReportType { get; set; } = null!;
    public string ScheduleCron { get; set; } = null!;
    public string? Format { get; set; } = "PDF"; // PDF | XLSX | BOTH
    public bool IsActive { get; set; } = true;
    public string? CreatedBy { get; set; }
}
