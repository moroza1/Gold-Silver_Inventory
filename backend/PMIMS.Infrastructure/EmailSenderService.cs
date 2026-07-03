using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using MimeKit;
using PMIMS.Application;

namespace PMIMS.Infrastructure;

// ============================================================
// Automatic Management Email Notifications (RFP item 7) -- SMTP dispatch via
// MailKit. Configuration is read from the "Email" section of appsettings.json
// (Email:SmtpHost/Port/Username/Password/FromAddress/FromName/UseSsl), mirroring
// the dev-only-placeholder pattern used for Jwt:Key and Fim:AesKey: safe local
// defaults, load real credentials from a secret store in production.
// ============================================================
public class EmailSenderService : IEmailSenderService
{
    private readonly IConfiguration _config;

    public EmailSenderService(IConfiguration config)
    {
        _config = config;
    }

    public async Task<(bool success, string? messageId, string? error)> SendAsync(
        string toEmail, string subject, string bodyHtml, IEnumerable<ReportAttachment>? attachments = null)
    {
        var section = _config.GetSection("Email");
        string host = section.GetValue<string>("SmtpHost") ?? "localhost";
        int port = section.GetValue<int?>("SmtpPort") ?? 25;
        string? username = section.GetValue<string>("Username");
        string? password = section.GetValue<string>("Password");
        bool useSsl = section.GetValue<bool?>("UseSsl") ?? false;
        string fromAddress = section.GetValue<string>("FromAddress") ?? "pmims-notifications@kfh.com.kw";
        string fromName = section.GetValue<string>("FromName") ?? "KFH PMIMS Notifications";

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(fromName, fromAddress));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = subject;

        var builder = new BodyBuilder { HtmlBody = bodyHtml };
        if (attachments != null)
        {
            foreach (var a in attachments)
                builder.Attachments.Add(a.FileName, a.Content, ContentType.Parse(a.ContentType));
        }
        message.Body = builder.ToMessageBody();

        string generatedMessageId = message.MessageId ?? Guid.NewGuid().ToString();

        try
        {
            using var client = new SmtpClient();
            await client.ConnectAsync(host, port, useSsl ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTlsWhenAvailable);
            if (!string.IsNullOrEmpty(username))
                await client.AuthenticateAsync(username, password);

            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            return (true, generatedMessageId, null);
        }
        catch (Exception ex)
        {
            return (false, generatedMessageId, ex.Message);
        }
    }
}
