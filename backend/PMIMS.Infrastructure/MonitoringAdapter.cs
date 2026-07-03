using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PMIMS.Application;
using PMIMS.Domain;

namespace PMIMS.Infrastructure;

// ============================================================
// KFH Existing Monitoring Tool Integration (RFP item 8) -- generic adapter,
// same "adapter, not vendor lock-in" approach as the KFH Integration
// Middleware design (docs/PMIMS_RFP_Gap_Closure_Design_Document.docx item 3):
// PMIMS pushes to a configured webhook URL in a simple JSON shape; adjust
// the payload mapping once KFH's specific monitoring tool is named, without
// touching any call site (ReconciliationService, health checks, ...).
//
// Every push is first recorded in monitoring_events (PushStatus=PENDING),
// then updated to SENT/FAILED after the HTTP call -- so monitoring_events is
// a reliable local audit of what was (attempted to be) pushed even if the
// external tool is unreachable, mirroring the FIM delta-sync-log philosophy.
// ============================================================
public class GenericWebhookMonitoringAdapter : IMonitoringAdapter
{
    private readonly AppDbContext _dbContext;
    private readonly IConfiguration _config;
    private static readonly HttpClient _httpClient = new HttpClient();

    public GenericWebhookMonitoringAdapter(AppDbContext dbContext, IConfiguration config)
    {
        _dbContext = dbContext;
        _config = config;
    }

    public async Task PushAsync(string eventType, string metricName, string metricValue, string severity, string serviceName = "PMIMS")
    {
        var evt = new MonitoringEvent
        {
            EventType = eventType,
            ServiceName = serviceName,
            MetricName = metricName,
            MetricValue = metricValue,
            Severity = severity,
            OccurredAt = DateTime.UtcNow,
            PushStatus = "PENDING"
        };
        _dbContext.MonitoringEvents.Add(evt);
        await _dbContext.SaveChangesAsync();

        bool enabled = _config.GetValue<bool?>("Monitoring:Enabled") ?? false;
        string? webhookUrl = _config.GetValue<string>("Monitoring:WebhookUrl");

        if (!enabled || string.IsNullOrWhiteSpace(webhookUrl))
        {
            evt.PushStatus = "DISABLED";
            await _dbContext.SaveChangesAsync();
            return;
        }

        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                service = serviceName,
                eventType,
                metricName,
                metricValue,
                severity,
                occurredAt = evt.OccurredAt
            });
            using var cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(5));
            var response = await _httpClient.PostAsync(webhookUrl, new StringContent(payload, Encoding.UTF8, "application/json"), cts.Token);

            evt.PushStatus = response.IsSuccessStatusCode ? "SENT" : "FAILED";
            evt.PushedAt = DateTime.UtcNow;
        }
        catch (Exception)
        {
            evt.PushStatus = "FAILED";
            evt.PushedAt = DateTime.UtcNow;
        }
        await _dbContext.SaveChangesAsync();
    }

    public async Task<SlaMetricsSnapshot> GetSlaMetricsAsync()
    {
        var cutoff24h = DateTime.UtcNow.AddHours(-24);

        int pendingWorkflows = await _dbContext.WorkflowInstances.CountAsync(w => w.StatusCode == "PENDING_MAKER");
        int openMismatches = await _dbContext.MismatchCases.CountAsync(c => c.StatusCode == "OPEN");
        int reconciliationBreaks = await _dbContext.ReconciliationRuns
            .Where(r => r.RunTimestamp >= cutoff24h)
            .SumAsync(r => (int?)r.TotalDiscrepancies) ?? 0;
        int alertEvents = await _dbContext.MonitoringEvents.CountAsync(e => e.EventType == "ALERT" && e.OccurredAt >= cutoff24h);

        string overall = "HEALTHY";
        if (alertEvents > 0 || openMismatches > 5) overall = "DEGRADED";
        if (openMismatches > 20) overall = "CRITICAL";

        return new SlaMetricsSnapshot
        {
            GeneratedAt = DateTime.UtcNow,
            PendingWorkflowInstances = pendingWorkflows,
            OpenMismatchCases = openMismatches,
            ReconciliationBreaksLast24h = reconciliationBreaks,
            AlertEventsLast24h = alertEvents,
            OverallStatus = overall
        };
    }

    public async Task<DetailedHealthStatus> GetDetailedHealthAsync(string environment)
    {
        var deps = new Dictionary<string, string>();

        try
        {
            deps["Database"] = await _dbContext.Database.CanConnectAsync() ? "Healthy" : "Unreachable";
        }
        catch (Exception ex)
        {
            deps["Database"] = $"Unreachable ({ex.GetType().Name})";
        }

        bool middlewareEnabled = _config.GetValue<bool?>("IntegrationMiddleware:Enabled") ?? false;
        deps["IntegrationMiddleware"] = middlewareEnabled ? "Configured" : "Not configured (design-only, item 3)";

        bool emailConfigured = !string.IsNullOrWhiteSpace(_config.GetValue<string>("Email:SmtpHost"));
        deps["EmailRelay"] = emailConfigured ? "Configured" : "Not configured";

        bool monitoringConfigured = _config.GetValue<bool?>("Monitoring:Enabled") ?? false;
        deps["MonitoringWebhook"] = monitoringConfigured ? "Configured" : "Not configured";

        bool anyUnhealthy = deps.Values.Any(v => v.StartsWith("Unreachable"));

        return new DetailedHealthStatus
        {
            Status = anyUnhealthy ? "Degraded" : "Healthy",
            Environment = environment,
            Timestamp = DateTime.UtcNow,
            Dependencies = deps
        };
    }
}
