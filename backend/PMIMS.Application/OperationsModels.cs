using System;
using System.Collections.Generic;
using PMIMS.Domain;

namespace PMIMS.Application;

// ============================================================
// Shared DTOs for RFP items 5-8 (Rules Engine, Audit Trail, Email
// Notifications, Monitoring Integration). Kept in one file since they are
// small and cross-referenced by the four new service interfaces below.
// ============================================================

// ---- Item 5: Rules Engine ----
public class RuleEvaluationDetail
{
    public int RuleId { get; set; }
    public string RuleCode { get; set; } = null!;
    public string Result { get; set; } = null!; // PASS, FAIL, WARN
    public string Severity { get; set; } = null!;
    public string Message { get; set; } = null!;
}

public class RuleEvaluationResult
{
    // False only if at least one BLOCK-severity rule FAILed; WARN-severity failures never
    // flip this to false, so callers can still surface warnings without blocking the operation.
    public bool Passed { get; set; } = true;
    public List<RuleEvaluationDetail> Details { get; set; } = new();
}

// ---- Item 6: Enhanced Audit Trail ----
public class AuditLogFilter
{
    public string? Query { get; set; }        // full-text search over action_description
    public string? Username { get; set; }
    public string? ModuleName { get; set; }
    public string? EntityType { get; set; }
    public string? StatusFilter { get; set; } // "verified" | "unverified" | "tampered" | null=all
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 50;
}

public class AuditLogSearchResultItem
{
    public int LogId { get; set; }
    public DateTime Timestamp { get; set; }
    public string Username { get; set; } = null!;
    public string IpAddress { get; set; } = null!;
    public string ModuleName { get; set; } = null!;
    public string ActionDescription { get; set; } = null!;
    public string? EntityType { get; set; }
    public string? EntityId { get; set; }
    // Verified = row_hash present and recomputed hash matches; Tampered = present but mismatches;
    // Unverified = no row_hash on the row (written before Item 6 shipped).
    public string TamperStatus { get; set; } = "Unverified";
}

public class AuditLogSearchResult
{
    public List<AuditLogSearchResultItem> Items { get; set; } = new();
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
}

// ---- Item 7: Automatic Management Email Notifications ----
public class ReportAttachment
{
    public string FileName { get; set; } = null!;
    public byte[] Content { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = "application/octet-stream";
}

// ---- Item 8: KFH Monitoring Integration ----
public class SlaMetricsSnapshot
{
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
    public int PendingWorkflowInstances { get; set; }
    public int OpenMismatchCases { get; set; }
    public int ReconciliationBreaksLast24h { get; set; }
    public int AlertEventsLast24h { get; set; }
    public string OverallStatus { get; set; } = "HEALTHY"; // HEALTHY, DEGRADED, CRITICAL
}

public class DetailedHealthStatus
{
    public string Status { get; set; } = "Healthy";
    public string Environment { get; set; } = null!;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public Dictionary<string, string> Dependencies { get; set; } = new(); // e.g. "Database" -> "Healthy"
}

// ============================================================
// Service interfaces (items 5-8)
// ============================================================

public interface IRuleEngineService
{
    Task<IEnumerable<BusinessRule>> GetRulesAsync(string? ruleType = null);
    Task<BusinessRule?> GetRuleAsync(int ruleId);
    Task<IEnumerable<BusinessRule>> GetRuleVersionsAsync(string ruleCode);
    Task<BusinessRule> CreateRuleAsync(string ruleCode, string ruleName, string ruleType, string expressionJson, string severity, string createdBy);
    Task<BusinessRule?> UpdateRuleAsync(string ruleCode, string ruleName, string expressionJson, string severity, string updatedBy);
    Task<bool> SetRuleActiveAsync(int ruleId, bool isActive);
    // Evaluates every active rule of ruleType against context; persists one
    // BusinessRuleEvaluation row per rule evaluated.
    Task<RuleEvaluationResult> EvaluateAsync(string ruleType, string entityType, string entityId, Dictionary<string, object> context);
}

public interface IAuditExportService
{
    byte[] ExportToExcel(IEnumerable<AuditLogSearchResultItem> logs);
    byte[] ExportToPdf(IEnumerable<AuditLogSearchResultItem> logs, string title);
    byte[] ExportToCsv(IEnumerable<AuditLogSearchResultItem> logs);
    // Reused by Item 7's scheduled reports (inventory balance / low-stock / high-value movement)
    // and by the on-demand official reports endpoints (inventory balance / transaction log /
    // reconciliation differences -- see PMIMSControllers.Reports.cs).
    byte[] ExportTableToExcel(string sheetTitle, IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows);
    byte[] ExportTableToPdf(string title, IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows);
    byte[] ExportTableToCsv(IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows);
}

public interface IEmailSenderService
{
    Task<(bool success, string? messageId, string? error)> SendAsync(string toEmail, string subject, string bodyHtml, IEnumerable<ReportAttachment>? attachments = null);
}

// ---- Item 7 extension: immediate (event-triggered) customer/management notifications ----
// Reuses the same NotificationSubscription distribution-list config and NotificationDelivery
// audit trail as the cron-scheduled batch reports (see NotificationSchedulerService), but is
// invoked inline by the call site the moment a key event happens -- e.g. a branch transfer
// completing (TRANSFER_COMPLETED) or a reconciliation run finding a break
// (INVENTORY_DISCREPANCY) -- instead of waiting for the next scheduled cron tick. Kept as its
// own small Application-layer service (rather than duplicating the "look up active
// subscriptions -> send -> record delivery" loop at each call site) so both
// ReconciliationService and PMIMSControllers can share it.
public interface INotificationDispatchService
{
    Task DispatchAsync(string reportType, string subject, string bodyHtml);
}

public interface IMonitoringAdapter
{
    Task PushAsync(string eventType, string metricName, string metricValue, string severity, string serviceName = "PMIMS");
    Task<SlaMetricsSnapshot> GetSlaMetricsAsync();
    Task<DetailedHealthStatus> GetDetailedHealthAsync(string environment);
}
