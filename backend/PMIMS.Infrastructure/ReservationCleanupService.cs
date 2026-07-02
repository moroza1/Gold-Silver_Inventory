using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PMIMS.Application;

namespace PMIMS.Infrastructure;

public class ReservationCleanupService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ReservationCleanupService> _logger;

    public ReservationCleanupService(IServiceProvider serviceProvider, ILogger<ReservationCleanupService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PMIMS Reservation TTL Cleanup Daemon started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using (var scope = _serviceProvider.CreateScope())
                {
                    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var inventoryRepo = scope.ServiceProvider.GetRequiredService<IInventoryRepository>();

                    var now = DateTime.UtcNow;
                    var expiredReservations = dbContext.ReservationRequests
                        .Where(r => r.StatusCode == "ACTIVE" && r.ExpiresAt < now)
                        .ToList();

                    if (expiredReservations.Any())
                    {
                        _logger.LogInformation($"Found {expiredReservations.Count} expired gold reservation locks. Triggering cleanup...");

                        foreach (var reservation in expiredReservations)
                        {
                            await inventoryRepo.CancelReservationAsync(reservation.ReservationToken);
                            _logger.LogInformation($"Cancelled expired reservation Token: {reservation.ReservationToken} for Customer ID: {reservation.CustomerId}");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during reservation locks cleanup cycle.");
            }

            // Sleep for 10 seconds before checking again
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        }
    }
}
