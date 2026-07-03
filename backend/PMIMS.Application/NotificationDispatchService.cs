using System.Linq;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

// ============================================================
// Automatic Management Email Notifications (RFP item 7) -- immediate/event-triggered path.
// See INotificationDispatchService for why this exists separately from
// NotificationSchedulerService (Infrastructure), which handles the cron-scheduled batch
// reports (INVENTORY_BALANCE / LOW_STOCK / HIGH_VALUE_MOVEMENT). This service only needs
// IInventoryRepository + IEmailSenderService (both Application-layer interfaces), so it lives
// here rather than in Infrastructure -- no EF/DbContext dependency required.
// ============================================================
public class NotificationDispatchService : INotificationDispatchService
{
    private readonly IInventoryRepository _repository;
    private readonly IEmailSenderService _emailSender;

    public NotificationDispatchService(IInventoryRepository repository, IEmailSenderService emailSender)
    {
        _repository = repository;
        _emailSender = emailSender;
    }

    public async Task DispatchAsync(string reportType, string subject, string bodyHtml)
    {
        var subscriptions = (await _repository.GetNotificationSubscriptionsAsync())
            .Where(s => s.IsActive && s.ReportType == reportType);

        foreach (var sub in subscriptions)
        {
            var (success, messageId, error) = await _emailSender.SendAsync(sub.DistributionListEmail, subject, bodyHtml);

            await _repository.RecordNotificationDeliveryAsync(new NotificationDelivery
            {
                SubscriptionId = sub.SubscriptionId,
                StatusCode = success ? "SENT" : "FAILED",
                MessageId = messageId,
                FailureReason = error
            });
        }
    }
}
