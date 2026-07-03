using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Cronos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

// ============================================================
// Automatic Management Email Notifications (RFP item 7) -- scheduled report
// generation + dispatch. Same hosted-BackgroundService pattern as
// ReservationCleanupService, polling every CheckIntervalMinutes for due
// subscriptions (Cronos evaluates each subscription's ScheduleCron). Report
// tables are rendered via AuditExportService.ExportTableToExcel/Pdf (shared
// with Item 6), so PMIMS has exactly one table-rendering implementation.
// ============================================================
public class NotificationSchedulerService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IConfiguration _config;
    private readonly ILogger<NotificationSchedulerService> _logger;

    public NotificationSchedulerService(IServiceProvider serviceProvider, IConfiguration config, ILogger<NotificationSchedulerService> logger)
    {
        _serviceProvider = serviceProvider;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PMIMS Notification Scheduler started.");
        int intervalMinutes = _config.GetValue<int?>("Notifications:LowStockThresholdCheckIntervalMinutes") ?? 5;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var repo = scope.ServiceProvider.GetRequiredService<IInventoryRepository>();
                var exporter = scope.ServiceProvider.GetRequiredService<IAuditExportService>();
                var mailer = scope.ServiceProvider.GetRequiredService<IEmailSenderService>();

                // TRANSFER_COMPLETED / INVENTORY_DISCREPANCY are event-triggered (see
                // PMIMSControllers.NotifyIfTransferCompletedAsync and
                // ReconciliationService.RunReconciliationAsync) -- they fire immediately at the
                // moment of the event via INotificationDispatchService, not on this cron loop.
                // A subscription of one of those types still stores a ScheduleCron value (schema
                // requires it) but it is intentionally never evaluated here.
                var subscriptions = (await repo.GetNotificationSubscriptionsAsync())
                    .Where(s => s.IsActive && s.ReportType != "TRANSFER_COMPLETED" && s.ReportType != "INVENTORY_DISCREPANCY")
                    .ToList();
                foreach (var sub in subscriptions)
                {
                    if (!IsDue(sub)) continue;

                    try
                    {
                        var (headers, rows) = await BuildReportAsync(repo, sub.ReportType);
                        var attachments = new List<ReportAttachment>();

                        if (sub.Format is "XLSX" or "BOTH")
                        {
                            attachments.Add(new ReportAttachment
                            {
                                FileName = $"{sub.ReportType}_{DateTime.UtcNow:yyyyMMdd}.xlsx",
                                Content = exporter.ExportTableToExcel(sub.ReportType, headers, rows),
                                ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            });
                        }
                        if (sub.Format is "PDF" or "BOTH")
                        {
                            attachments.Add(new ReportAttachment
                            {
                                FileName = $"{sub.ReportType}_{DateTime.UtcNow:yyyyMMdd}.pdf",
                                Content = exporter.ExportTableToPdf($"PMIMS Scheduled Report -- {sub.ReportType}", headers, rows),
                                ContentType = "application/pdf"
                            });
                        }

                        string bodyHtml = $"<p>Attached is the scheduled <b>{sub.ReportType}</b> report from KFH PMIMS, generated {DateTime.UtcNow:u}.</p>" +
                            "<p style='font-size:11px;color:#888'>You are receiving this because your address is on the PMIMS management distribution list for this report. " +
                            $"To stop receiving it, use the unsubscribe link included in future deliveries, or contact IT Administration (subscription id {sub.SubscriptionId}).</p>";

                        var (success, messageId, error) = await mailer.SendAsync(sub.DistributionListEmail, $"KFH PMIMS -- {sub.ReportType} Report", bodyHtml, attachments);

                        await repo.RecordNotificationDeliveryAsync(new NotificationDelivery
                        {
                            SubscriptionId = sub.SubscriptionId,
                            SentAt = DateTime.UtcNow,
                            StatusCode = success ? "SENT" : "FAILED",
                            MessageId = messageId,
                            FailureReason = error
                        });

                        sub.LastRunAt = DateTime.UtcNow;
                        await repo.SaveNotificationSubscriptionAsync(sub);

                        _logger.LogInformation("Notification subscription {SubId} ({ReportType}) delivered: {Success}", sub.SubscriptionId, sub.ReportType, success);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to process notification subscription {SubId}", sub.SubscriptionId);
                        await repo.RecordNotificationDeliveryAsync(new NotificationDelivery
                        {
                            SubscriptionId = sub.SubscriptionId,
                            SentAt = DateTime.UtcNow,
                            StatusCode = "FAILED",
                            FailureReason = ex.Message
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during notification scheduler cycle.");
            }

            await Task.Delay(TimeSpan.FromMinutes(Math.Max(1, intervalMinutes)), stoppingToken);
        }
    }

    private static bool IsDue(NotificationSubscription sub)
    {
        try
        {
            var cron = CronExpression.Parse(sub.ScheduleCron);
            var from = sub.LastRunAt ?? DateTime.UtcNow.AddDays(-1);
            var next = cron.GetNextOccurrence(from, TimeZoneInfo.Utc);
            return next.HasValue && next.Value <= DateTime.UtcNow;
        }
        catch (CronFormatException)
        {
            return false; // malformed cron -- never fires; surfaced via GET /api/notifications/subscriptions for an admin to fix
        }
    }

    private static async Task<(IReadOnlyList<string> headers, List<IReadOnlyList<string>> rows)> BuildReportAsync(IInventoryRepository repo, string reportType)
    {
        switch (reportType)
        {
            case "LOW_STOCK":
            {
                var headers = new[] { "Product", "Vendor", "Current Stock", "Min Threshold", "Reorder Qty" };
                var thresholds = (await repo.GetReorderThresholdsAsync()).Where(t => t.IsActive).ToList();
                var items = (await repo.GetItemsAsync()).ToList();
                var rows = new List<IReadOnlyList<string>>();
                foreach (var t in thresholds)
                {
                    int current = items.Count(i => i.ProductId == t.ProductId && i.StatusCode == "READY");
                    if (current > t.MinStockQty) continue;
                    rows.Add(new[] { t.Product?.ProductCode ?? $"#{t.ProductId}", t.Vendor?.VendorName ?? "", current.ToString(), t.MinStockQty.ToString(), t.ReorderQty.ToString() });
                }
                return (headers, rows);
            }
            case "HIGH_VALUE_MOVEMENT":
            {
                var headers = new[] { "Transaction #", "Type", "Serial", "Rate Used (KWD)", "Timestamp" };
                var cutoff = DateTime.UtcNow.AddDays(-1);
                var txs = (await repo.GetTransactionsAsync())
                    .Where(t => t.TransactionTimestamp >= cutoff && t.RateUsed.HasValue)
                    .OrderByDescending(t => t.RateUsed)
                    .ToList();
                var rows = txs.Select(t => (IReadOnlyList<string>)new[]
                {
                    t.TransactionNumber, t.TransactionType, t.Item?.SerialNumber ?? "", t.RateUsed!.Value.ToString("N2"), t.TransactionTimestamp.ToString("u")
                }).ToList();
                return (headers, rows);
            }
            case "INVENTORY_BALANCE":
            default:
            {
                var headers = new[] { "Vault", "Metal Type", "Ready Qty" };
                var items = (await repo.GetItemsAsync()).Where(i => i.StatusCode == "READY").ToList();
                var grouped = items.GroupBy(i => (Vault: i.Location?.Vault?.VaultName ?? "Unknown", Metal: i.Product?.MetalType?.MetalName ?? "Unknown"))
                    .Select(g => new[] { g.Key.Vault, g.Key.Metal, g.Count().ToString() })
                    .ToList();
                return (headers, grouped.Cast<IReadOnlyList<string>>().ToList());
            }
        }
    }
}
