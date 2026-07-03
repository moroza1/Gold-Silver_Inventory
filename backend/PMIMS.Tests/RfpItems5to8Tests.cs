using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PMIMS.Application;
using PMIMS.Domain;
using PMIMS.Infrastructure;
using Xunit;

namespace PMIMS.Tests;

// Coverage for RFP items 5-8: Dynamic Business Validation Rules Engine,
// Enhanced Audit Trail UI (tamper-evident search/export), Automatic
// Management Email Notifications, and KFH Existing Monitoring Tool
// Integration. Same SQLite-in-memory-per-test pattern as FimServiceTests.cs
// so these exercise the real InventoryRepository implementation, not mocks.
public class RfpItems5to8Tests
{
    static RfpItems5to8Tests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    private class DbSetup : IDisposable
    {
        public AppDbContext Context { get; }
        public SqliteConnection Connection { get; }

        public DbSetup(AppDbContext context, SqliteConnection connection)
        {
            Context = context;
            Connection = connection;
        }

        public void Dispose()
        {
            Context.Dispose();
            Connection.Dispose();
        }
    }

    private DbSetup CreateContext()
    {
        var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(conn)
            .Options;

        var context = new AppDbContext(options);
        context.Database.EnsureDeleted();
        context.Database.EnsureCreated();
        return new DbSetup(context, conn);
    }

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    // =========================================================================
    // Item 5: Dynamic Business Validation Rules Engine
    // =========================================================================

    [Fact]
    public async Task CreateRuleAsync_Then_EvaluateAsync_BlocksWhenConditionMet()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        var engine = new RuleEngineService(repo);

        // The predicate tree describes the CONDITION THAT FLAGS A PROBLEM (see
        // RuleEngineService.EvaluateAsync): "gt 5000" fires when the transfer exceeds the limit.
        await engine.CreateRuleAsync(
            "TRANSFER_LIMIT_TEST",
            "Test Transfer Weight Limit",
            "TRANSFER_LIMIT",
            "{\"all\":[{\"field\":\"weightGrams\",\"op\":\"gt\",\"value\":5000}]}",
            "BLOCK",
            "unit-test");

        // 4000g is within the 5000g limit -> condition does NOT fire -> PASS.
        var passResult = await engine.EvaluateAsync("TRANSFER_LIMIT", "InventoryItem", "1", new Dictionary<string, object> { { "weightGrams", 4000m } });
        Assert.True(passResult.Passed);
        Assert.Single(passResult.Details);
        Assert.Equal("PASS", passResult.Details[0].Result);

        // 6000g exceeds the 5000g limit -> condition fires -> BLOCK severity -> FAIL -> not Passed.
        var failResult = await engine.EvaluateAsync("TRANSFER_LIMIT", "InventoryItem", "2", new Dictionary<string, object> { { "weightGrams", 6000m } });
        Assert.False(failResult.Passed);
        Assert.Equal("FAIL", failResult.Details[0].Result);

        // Persisted evaluations exist for both calls.
        Assert.Equal(2, db.Context.BusinessRuleEvaluations.Count());
    }

    [Fact]
    public async Task CreateRuleAsync_DuplicateRuleCode_Throws()
    {
        using var db = CreateContext();
        var engine = new RuleEngineService(new InventoryRepository(db.Context));

        string expr = "{\"all\":[{\"field\":\"x\",\"op\":\"eq\",\"value\":1}]}";
        await engine.CreateRuleAsync("DUPE_CODE", "First", "TRANSFER_LIMIT", expr, "BLOCK", "unit-test");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            engine.CreateRuleAsync("DUPE_CODE", "Second", "TRANSFER_LIMIT", expr, "BLOCK", "unit-test"));
    }

    [Fact]
    public async Task CreateRuleAsync_InvalidRuleTypeOrSeverity_Throws()
    {
        using var db = CreateContext();
        var engine = new RuleEngineService(new InventoryRepository(db.Context));
        string expr = "{\"all\":[{\"field\":\"x\",\"op\":\"eq\",\"value\":1}]}";

        await Assert.ThrowsAsync<ArgumentException>(() =>
            engine.CreateRuleAsync("BAD_TYPE", "Name", "NOT_A_REAL_TYPE", expr, "BLOCK", "unit-test"));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            engine.CreateRuleAsync("BAD_SEVERITY", "Name", "TRANSFER_LIMIT", expr, "CATASTROPHIC", "unit-test"));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            engine.CreateRuleAsync("BAD_JSON", "Name", "TRANSFER_LIMIT", "{not valid json", "BLOCK", "unit-test"));
    }

    [Fact]
    public async Task UpdateRuleAsync_AppendsNewVersion_SupersedesPrevious_HistoryPreserved()
    {
        using var db = CreateContext();
        var engine = new RuleEngineService(new InventoryRepository(db.Context));
        string exprV1 = "{\"all\":[{\"field\":\"x\",\"op\":\"eq\",\"value\":1}]}";
        string exprV2 = "{\"all\":[{\"field\":\"x\",\"op\":\"eq\",\"value\":2}]}";

        var v1 = await engine.CreateRuleAsync("VERSIONED_RULE", "V1", "INVENTORY_CHECK", exprV1, "WARN", "unit-test");
        var v2 = await engine.UpdateRuleAsync("VERSIONED_RULE", "V2", exprV2, "BLOCK", "unit-test-2");

        Assert.NotNull(v2);
        Assert.Equal(2, v2!.Version);
        Assert.True(v2.IsActive);

        var versions = (await engine.GetRuleVersionsAsync("VERSIONED_RULE")).ToList();
        Assert.Equal(2, versions.Count);
        Assert.False(versions.Single(v => v.Version == 1).IsActive); // v1 superseded
        Assert.True(versions.Single(v => v.Version == 2).IsActive);
    }

    [Fact]
    public async Task UpdateRuleAsync_UnknownRuleCode_ReturnsNull()
    {
        using var db = CreateContext();
        var engine = new RuleEngineService(new InventoryRepository(db.Context));
        var result = await engine.UpdateRuleAsync("DOES_NOT_EXIST", "X", "{\"all\":[]}", "WARN", "unit-test");
        Assert.Null(result);
    }

    [Fact]
    public async Task EvaluateAsync_MalformedExpressionOnActiveRule_TreatedAsNonBlockingWarn()
    {
        using var db = CreateContext();
        // Insert a malformed rule directly (bypassing CreateRuleAsync's validation) to simulate
        // data corruption / a hand-edited DB row -- EvaluateAsync must never throw or crash the
        // calling business operation (see RuleEngineService.EvaluateAsync comment).
        db.Context.BusinessRules.Add(new BusinessRule
        {
            RuleCode = "CORRUPTED",
            RuleName = "Corrupted Rule",
            RuleType = "TRANSFER_LIMIT",
            ExpressionJson = "{ this is not valid json",
            Severity = "BLOCK",
            Version = 1,
            IsActive = true
        });
        await db.Context.SaveChangesAsync();

        var engine = new RuleEngineService(new InventoryRepository(db.Context));
        var result = await engine.EvaluateAsync("TRANSFER_LIMIT", "InventoryItem", "1", new Dictionary<string, object>());

        Assert.True(result.Passed); // malformed rule never blocks
        Assert.Equal("PASS", result.Details[0].Result);
        Assert.Contains("could not be evaluated", result.Details[0].Message);
    }

    [Fact]
    public async Task SetRuleActiveAsync_DeactivatesRule_ExcludedFromActiveOnlyEvaluation()
    {
        using var db = CreateContext();
        var engine = new RuleEngineService(new InventoryRepository(db.Context));
        var rule = await engine.CreateRuleAsync("TOGGLE_RULE", "Toggle", "RATE_THRESHOLD",
            "{\"all\":[{\"field\":\"rate\",\"op\":\"gt\",\"value\":0}]}", "BLOCK", "unit-test");

        bool ok = await engine.SetRuleActiveAsync(rule.RuleId, false);
        Assert.True(ok);

        var result = await engine.EvaluateAsync("RATE_THRESHOLD", "Rate", "1", new Dictionary<string, object> { { "rate", 5m } });
        Assert.Empty(result.Details); // inactive rule is skipped entirely
        Assert.True(result.Passed);

        Assert.False(await engine.SetRuleActiveAsync(999999, true)); // unknown rule id
    }

    // =========================================================================
    // Item 6: Enhanced Audit Trail UI (tamper-evident search/export)
    // =========================================================================

    [Fact]
    public async Task SaveAuditLogAsync_ComputesRowHash_SearchReportsVerified()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);

        await repo.SaveAuditLogAsync("treasury-maker", "10.0.0.5", "purchase_orders", "Created PO #100", entityType: "PurchaseOrder", entityId: "100");

        var result = await repo.SearchAuditLogsAsync(new AuditLogFilter());
        Assert.Single(result.Items);
        Assert.Equal("Verified", result.Items[0].TamperStatus);
        Assert.Equal("PurchaseOrder", result.Items[0].EntityType);
    }

    [Fact]
    public async Task SearchAuditLogsAsync_DirectRowMutation_DetectedAsTampered()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        await repo.SaveAuditLogAsync("treasury-checker", "10.0.0.6", "purchase_orders", "Approved PO #100", entityType: "PurchaseOrder", entityId: "100");

        // Simulate an out-of-band edit to the row (bypassing SaveAuditLogAsync, so the stored
        // RowHash is now stale relative to the row's content) -- this is exactly the tamper
        // scenario Item 6's hash check is designed to catch.
        var log = await db.Context.AuditLogs.FirstAsync();
        log.ActionDescription = "Approved PO #100 -- amount silently changed";
        await db.Context.SaveChangesAsync();

        var fetched = await repo.GetAuditLogByIdAsync(log.LogId);
        Assert.NotNull(fetched);
        Assert.Equal("Tampered", fetched!.TamperStatus);
    }

    [Fact]
    public async Task GetAuditLogByIdAsync_LegacyRowWithoutHash_ReportsUnverified()
    {
        using var db = CreateContext();
        // Simulate a pre-Item-6 row (row_hash never populated) by inserting directly.
        db.Context.AuditLogs.Add(new AuditLog
        {
            Username = "legacy-user",
            IpAddress = "0.0.0.0",
            ModuleName = "settings",
            ActionDescription = "Pre-existing legacy audit row",
            Timestamp = DateTime.UtcNow,
            RowHash = null
        });
        await db.Context.SaveChangesAsync();
        var log = await db.Context.AuditLogs.FirstAsync();

        var repo = new InventoryRepository(db.Context);
        var fetched = await repo.GetAuditLogByIdAsync(log.LogId);

        Assert.Equal("Unverified", fetched!.TamperStatus);
    }

    [Fact]
    public async Task SearchAuditLogsAsync_FiltersByUsernameModuleAndStatus()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        await repo.SaveAuditLogAsync("treasury-maker", "1.1.1.1", "purchase_orders", "Action A");
        await repo.SaveAuditLogAsync("treasury-checker", "1.1.1.2", "user_admin", "Action B");
        await repo.SaveAuditLogAsync("treasury-maker", "1.1.1.3", "user_admin", "Action C");

        var byUser = await repo.SearchAuditLogsAsync(new AuditLogFilter { Username = "treasury-maker" });
        Assert.Equal(2, byUser.TotalCount);

        var byModule = await repo.SearchAuditLogsAsync(new AuditLogFilter { ModuleName = "user_admin" });
        Assert.Equal(2, byModule.TotalCount);

        var byBoth = await repo.SearchAuditLogsAsync(new AuditLogFilter { Username = "treasury-maker", ModuleName = "user_admin" });
        Assert.Equal(1, byBoth.TotalCount);
        Assert.Equal("Action C", byBoth.Items[0].ActionDescription);

        var verifiedOnly = await repo.SearchAuditLogsAsync(new AuditLogFilter { StatusFilter = "verified" });
        Assert.Equal(3, verifiedOnly.TotalCount);
    }

    [Fact]
    public void AuditExportService_ExportToCsvExcelPdf_ProduceNonEmptyOutput()
    {
        var exporter = new AuditExportService();
        var logs = new List<AuditLogSearchResultItem>
        {
            new() { LogId = 1, Timestamp = DateTime.UtcNow, Username = "u1", IpAddress = "1.2.3.4", ModuleName = "reports", ActionDescription = "Viewed report", TamperStatus = "Verified" }
        };

        byte[] csv = exporter.ExportToCsv(logs);
        byte[] xlsx = exporter.ExportToExcel(logs);
        byte[] pdf = exporter.ExportToPdf(logs, "Audit Export Test");

        Assert.True(csv.Length > 0);
        Assert.Contains("u1", System.Text.Encoding.UTF8.GetString(csv));
        Assert.True(xlsx.Length > 0);
        Assert.True(pdf.Length > 0);
        // PDF files start with the "%PDF-" magic bytes.
        Assert.Equal("%PDF-", System.Text.Encoding.ASCII.GetString(pdf, 0, 5));
    }

    // =========================================================================
    // Item 7: Automatic Management Email Notifications
    // =========================================================================

    [Fact]
    public async Task SaveNotificationSubscriptionAsync_InsertThenUpdate_RoundTrips()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);

        var created = await repo.SaveNotificationSubscriptionAsync(new NotificationSubscription
        {
            DistributionListEmail = "ops@kfh.com.kw",
            ReportType = "LOW_STOCK",
            ScheduleCron = "0 7 * * *",
            Format = "PDF",
            IsActive = true,
            CreatedBy = "unit-test"
        });
        Assert.True(created.SubscriptionId > 0);

        created.Format = "BOTH";
        created.ScheduleCron = "0 8 * * *";
        var updated = await repo.SaveNotificationSubscriptionAsync(created);

        Assert.Equal(created.SubscriptionId, updated.SubscriptionId);
        Assert.Equal("BOTH", updated.Format);
        Assert.Equal("0 8 * * *", updated.ScheduleCron);
        Assert.Single(await repo.GetNotificationSubscriptionsAsync());
    }

    [Fact]
    public async Task SaveNotificationSubscriptionAsync_UnknownId_Throws()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repo.SaveNotificationSubscriptionAsync(new NotificationSubscription { SubscriptionId = 9999, DistributionListEmail = "x@kfh.com.kw", ReportType = "LOW_STOCK", ScheduleCron = "0 7 * * *" }));
    }

    [Fact]
    public async Task UnsubscribeAsync_SetsInactiveAndTimestamp_IdempotentOnRepeat()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        var sub = await repo.SaveNotificationSubscriptionAsync(new NotificationSubscription
        {
            DistributionListEmail = "ops2@kfh.com.kw", ReportType = "INVENTORY_BALANCE", ScheduleCron = "0 6 * * *", IsActive = true
        });

        bool first = await repo.UnsubscribeAsync(sub.SubscriptionId);
        Assert.True(first);
        var reloaded = await repo.GetNotificationSubscriptionByIdAsync(sub.SubscriptionId);
        Assert.False(reloaded!.IsActive);
        Assert.NotNull(reloaded.UnsubscribedAt);

        Assert.False(await repo.UnsubscribeAsync(999999)); // unknown id
    }

    [Fact]
    public async Task DeleteNotificationSubscriptionAsync_RemovesRow_ReturnsFalseIfMissing()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        var sub = await repo.SaveNotificationSubscriptionAsync(new NotificationSubscription
        {
            DistributionListEmail = "todelete@kfh.com.kw", ReportType = "LOW_STOCK", ScheduleCron = "0 7 * * *"
        });

        Assert.True(await repo.DeleteNotificationSubscriptionAsync(sub.SubscriptionId));
        Assert.False(await repo.DeleteNotificationSubscriptionAsync(sub.SubscriptionId));
        Assert.Empty(await repo.GetNotificationSubscriptionsAsync());
    }

    [Fact]
    public async Task RecordNotificationDeliveryAsync_And_GetNotificationDeliveriesAsync_FiltersBySubscription()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        var sub1 = await repo.SaveNotificationSubscriptionAsync(new NotificationSubscription { DistributionListEmail = "a@kfh.com.kw", ReportType = "LOW_STOCK", ScheduleCron = "0 7 * * *" });
        var sub2 = await repo.SaveNotificationSubscriptionAsync(new NotificationSubscription { DistributionListEmail = "b@kfh.com.kw", ReportType = "LOW_STOCK", ScheduleCron = "0 7 * * *" });

        await repo.RecordNotificationDeliveryAsync(new NotificationDelivery { SubscriptionId = sub1.SubscriptionId, StatusCode = "SENT", MessageId = "m1" });
        await repo.RecordNotificationDeliveryAsync(new NotificationDelivery { SubscriptionId = sub2.SubscriptionId, StatusCode = "FAILED", FailureReason = "SMTP timeout" });

        var all = await repo.GetNotificationDeliveriesAsync();
        Assert.Equal(2, all.Count());

        var forSub1 = await repo.GetNotificationDeliveriesAsync(sub1.SubscriptionId);
        Assert.Single(forSub1);
        Assert.Equal("SENT", forSub1.First().StatusCode);
    }

    [Fact]
    public async Task EmailSenderService_SendAsync_NoSmtpServerReachable_FailsGracefullyWithoutThrowing()
    {
        // No SMTP server is available in the test/sandbox environment -- SendAsync must catch
        // the connection failure and report it via the (success:false, error) tuple rather than
        // throwing, so a bad SMTP config never crashes the notification scheduler.
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Email:SmtpHost"] = "127.0.0.1",
            ["Email:SmtpPort"] = "1", // nothing listens on port 1
            ["Email:FromAddress"] = "pmims-notifications@kfh.com.kw"
        });
        var sender = new EmailSenderService(config);

        var (success, messageId, error) = await sender.SendAsync("recipient@kfh.com.kw", "Test", "<p>Body</p>");

        Assert.False(success);
        Assert.NotNull(messageId); // a message id is generated even on failure, for correlation
        Assert.NotNull(error);
    }

    // =========================================================================
    // Item 8: KFH Existing Monitoring Tool Integration
    // =========================================================================

    [Fact]
    public async Task MonitoringAdapter_PushAsync_DisabledByDefault_RecordsEventAsDisabled()
    {
        using var db = CreateContext();
        var config = BuildConfig(new Dictionary<string, string?>()); // Monitoring:Enabled absent -> defaults false
        var adapter = new GenericWebhookMonitoringAdapter(db.Context, config);

        await adapter.PushAsync("ALERT", "reconciliation_breaks_detected", "3", "CRITICAL");

        var evt = await db.Context.MonitoringEvents.FirstAsync();
        Assert.Equal("DISABLED", evt.PushStatus);
        Assert.Equal("reconciliation_breaks_detected", evt.MetricName);
    }

    [Fact]
    public async Task MonitoringAdapter_PushAsync_EnabledButUnreachableWebhook_RecordsFailed()
    {
        using var db = CreateContext();
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Monitoring:Enabled"] = "true",
            ["Monitoring:WebhookUrl"] = "http://127.0.0.1:1/webhook" // nothing listens here
        });
        var adapter = new GenericWebhookMonitoringAdapter(db.Context, config);

        await adapter.PushAsync("ALERT", "test_metric", "1", "WARNING");

        var evt = await db.Context.MonitoringEvents.FirstAsync();
        Assert.Equal("FAILED", evt.PushStatus);
    }

    [Fact]
    public async Task MonitoringAdapter_GetSlaMetricsAsync_ReflectsAlertEventCount_DegradesOverallStatus()
    {
        using var db = CreateContext();
        var config = BuildConfig(new Dictionary<string, string?>());
        var adapter = new GenericWebhookMonitoringAdapter(db.Context, config);

        var baseline = await adapter.GetSlaMetricsAsync();
        Assert.Equal(0, baseline.AlertEventsLast24h);
        Assert.Equal("HEALTHY", baseline.OverallStatus);

        // A recent ALERT-type monitoring event should both be counted and flip overall
        // status to DEGRADED (GetSlaMetricsAsync: alertEvents > 0 => DEGRADED).
        await adapter.PushAsync("ALERT", "reconciliation_breaks_detected", "3", "CRITICAL");
        var afterAlert = await adapter.GetSlaMetricsAsync();

        Assert.Equal(1, afterAlert.AlertEventsLast24h);
        Assert.Equal("DEGRADED", afterAlert.OverallStatus);
    }

    [Fact]
    public async Task MonitoringAdapter_GetDetailedHealthAsync_DatabaseReachable_ReportsHealthy()
    {
        using var db = CreateContext();
        var adapter = new GenericWebhookMonitoringAdapter(db.Context, BuildConfig(new Dictionary<string, string?>()));

        var status = await adapter.GetDetailedHealthAsync("SQLite Local Fallback");

        Assert.Equal("Healthy", status.Status);
        Assert.Equal("Healthy", status.Dependencies["Database"]);
        Assert.Equal("Not configured (design-only, item 3)", status.Dependencies["IntegrationMiddleware"]);
    }

    [Fact]
    public async Task SaveMonitoringAlertRouteAsync_InsertThenUpdate_RoundTrips()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);

        var created = await repo.SaveMonitoringAlertRouteAsync(new MonitoringAlertRoute
        {
            EventType = "ALERT", Severity = "CRITICAL", Destination = "kfh-monitoring-webhook", IsActive = true
        });
        Assert.True(created.RouteId > 0);

        created.Destination = "kfh-monitoring-webhook-v2";
        var updated = await repo.SaveMonitoringAlertRouteAsync(created);
        Assert.Equal("kfh-monitoring-webhook-v2", updated.Destination);

        Assert.Single(await repo.GetMonitoringAlertRoutesAsync());
    }

    [Fact]
    public async Task SaveMonitoringAlertRouteAsync_UnknownId_Throws()
    {
        using var db = CreateContext();
        var repo = new InventoryRepository(db.Context);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            repo.SaveMonitoringAlertRouteAsync(new MonitoringAlertRoute { RouteId = 9999, EventType = "ALERT", Severity = "CRITICAL", Destination = "x" }));
    }

    [Fact]
    public async Task GetRecentMonitoringEventsAsync_ExcludesEventsOlderThanWindow()
    {
        using var db = CreateContext();
        db.Context.MonitoringEvents.AddRange(
            new MonitoringEvent { EventType = "ALERT", ServiceName = "PMIMS", MetricName = "old_event", MetricValue = "1", Severity = "INFO", OccurredAt = DateTime.UtcNow.AddHours(-48), PushStatus = "DISABLED" },
            new MonitoringEvent { EventType = "ALERT", ServiceName = "PMIMS", MetricName = "recent_event", MetricValue = "1", Severity = "INFO", OccurredAt = DateTime.UtcNow.AddHours(-1), PushStatus = "DISABLED" }
        );
        await db.Context.SaveChangesAsync();

        var repo = new InventoryRepository(db.Context);
        var recent = (await repo.GetRecentMonitoringEventsAsync(24)).ToList();

        Assert.Single(recent);
        Assert.Equal("recent_event", recent[0].MetricName);
    }
}
