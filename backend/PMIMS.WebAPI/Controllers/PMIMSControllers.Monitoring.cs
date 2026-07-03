using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using PMIMS.Domain;

namespace PMIMS.WebAPI.Controllers;

// =========================================================================
// KFH Existing Monitoring Tool Integration (RFP item 8)
// GET /api/health/detailed is anonymous, matching the existing GET /api/health
// (Program.cs) -- external monitoring tools poll it without a user JWT.
// Alert-route configuration is admin-tier (`monitoring` module).
// =========================================================================
public partial class PMIMSControllers
{
    [AllowAnonymous]
    [HttpGet("health/detailed")]
    public async Task<IActionResult> GetDetailedHealth()
    {
        bool useSqlServer = _config.GetValue<bool>("DatabaseConfig:UseSqlServer");
        var status = await _monitoringAdapter.GetDetailedHealthAsync(useSqlServer ? "SQL Server" : "SQLite Local Fallback");
        return Ok(status);
    }

    [Authorize(Policy = "monitoring.read")]
    [HttpGet("monitoring/sla-metrics")]
    public async Task<IActionResult> GetSlaMetrics()
    {
        var metrics = await _monitoringAdapter.GetSlaMetricsAsync();
        return Ok(metrics);
    }

    [Authorize(Policy = "monitoring.read")]
    [HttpGet("monitoring/events")]
    public async Task<IActionResult> GetRecentMonitoringEvents([FromQuery] int hours = 24)
    {
        var events = await _repository.GetRecentMonitoringEventsAsync(hours);
        return Ok(events.Select(e => new
        {
            event_id = e.EventId,
            event_type = e.EventType,
            service_name = e.ServiceName,
            metric_name = e.MetricName,
            metric_value = e.MetricValue,
            severity = e.Severity,
            occurred_at = e.OccurredAt,
            pushed_at = e.PushedAt,
            push_status = e.PushStatus
        }));
    }

    [Authorize(Policy = "monitoring.read")]
    [HttpGet("monitoring/alert-routes")]
    public async Task<IActionResult> GetMonitoringAlertRoutes()
    {
        var routes = await _repository.GetMonitoringAlertRoutesAsync();
        return Ok(routes.Select(r => new { route_id = r.RouteId, event_type = r.EventType, severity = r.Severity, destination = r.Destination, is_active = r.IsActive }));
    }

    [Authorize(Policy = "monitoring.write")]
    [HttpPost("monitoring/alert-routes")]
    public async Task<IActionResult> SaveMonitoringAlertRoute([FromBody] SaveMonitoringAlertRouteRequest req)
    {
        var route = await _repository.SaveMonitoringAlertRouteAsync(new MonitoringAlertRoute
        {
            RouteId = req.RouteId ?? 0,
            EventType = req.EventType,
            Severity = req.Severity,
            Destination = req.Destination,
            IsActive = req.IsActive
        });
        return Ok(new { route_id = route.RouteId, event_type = route.EventType, severity = route.Severity, destination = route.Destination, is_active = route.IsActive });
    }
}

public class SaveMonitoringAlertRouteRequest
{
    public int? RouteId { get; set; }
    public string EventType { get; set; } = null!;
    public string Severity { get; set; } = null!;
    public string Destination { get; set; } = null!;
    public bool IsActive { get; set; } = true;
}
