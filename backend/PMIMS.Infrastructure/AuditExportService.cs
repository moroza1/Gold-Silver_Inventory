using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using ClosedXML.Excel;
using PMIMS.Application;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace PMIMS.Infrastructure;

// ============================================================
// Enhanced Audit Trail UI (RFP item 6) export support -- also reused by Item 7
// (Automatic Management Email Notifications) for scheduled report attachments
// via ExportTableToExcel/ExportTableToPdf, so the two items share one
// well-tested rendering path instead of duplicating table-layout code.
//
// LICENSING NOTE: PDF generation uses QuestPDF, whose free "Community" tier
// is capped at $1M USD annual gross revenue -- KFH will need a QuestPDF
// Commercial license before production use (see PMIMS.Infrastructure.csproj
// comment). QuestPDF.Settings.License is configured once at startup
// (Program.cs); do not set it per-call.
// ============================================================
public class AuditExportService : IAuditExportService
{
    private static readonly string[] AuditHeaders = { "Log ID", "Timestamp (UTC)", "User", "IP Address", "Module", "Action", "Entity", "Tamper Status" };

    public byte[] ExportToExcel(IEnumerable<AuditLogSearchResultItem> logs)
    {
        var rows = logs.Select(ToRow);
        return ExportTableToExcel("Audit Log Export", AuditHeaders, rows);
    }

    public byte[] ExportToPdf(IEnumerable<AuditLogSearchResultItem> logs, string title)
    {
        var rows = logs.Select(ToRow);
        return ExportTableToPdf(title, AuditHeaders, rows);
    }

    public byte[] ExportToCsv(IEnumerable<AuditLogSearchResultItem> logs)
    {
        var rows = logs.Select(ToRow);
        return ExportTableToCsvBytes(AuditHeaders, rows);
    }

    // Generic CSV export, same "reuse one table-rendering path" rationale as
    // ExportTableToExcel/ExportTableToPdf -- used by the on-demand official reports
    // (inventory balance / transaction log / reconciliation differences).
    public byte[] ExportTableToCsv(IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows) =>
        ExportTableToCsvBytes(headers, rows);

    private static IReadOnlyList<string> ToRow(AuditLogSearchResultItem log) => new[]
    {
        log.LogId.ToString(),
        log.Timestamp.ToString("u"),
        log.Username,
        log.IpAddress,
        log.ModuleName,
        log.ActionDescription,
        string.IsNullOrEmpty(log.EntityType) ? "" : $"{log.EntityType} #{log.EntityId}",
        log.TamperStatus
    };

    // ---- generic table export, shared with Item 7's scheduled reports ----

    public byte[] ExportTableToExcel(string sheetTitle, IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows)
    {
        using var workbook = new XLWorkbook();
        // Excel sheet names cannot exceed 31 chars or contain : \ / ? * [ ]
        string safeTitle = new string(sheetTitle.Take(31).Select(c => "\\/?*[]:".Contains(c) ? '_' : c).ToArray());
        var sheet = workbook.Worksheets.Add(string.IsNullOrWhiteSpace(safeTitle) ? "Report" : safeTitle);

        for (int c = 0; c < headers.Count; c++)
        {
            var cell = sheet.Cell(1, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1F4E79");
            cell.Style.Font.FontColor = XLColor.White;
        }

        int r = 2;
        foreach (var row in rows)
        {
            for (int c = 0; c < row.Count; c++)
                sheet.Cell(r, c + 1).Value = row[c];
            r++;
        }

        sheet.Columns().AdjustToContents();
        sheet.SheetView.FreezeRows(1);

        using var ms = new MemoryStream();
        workbook.SaveAs(ms);
        return ms.ToArray();
    }

    public byte[] ExportTableToPdf(string title, IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows)
    {
        var rowList = rows.ToList();

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(24);
                page.DefaultTextStyle(x => x.FontSize(8));

                page.Header().Column(col =>
                {
                    col.Item().Text(title).SemiBold().FontSize(16);
                    col.Item().Text($"Generated {DateTime.UtcNow:u} -- {rowList.Count} row(s)").FontSize(8).FontColor(Colors.Grey.Darken1);
                });

                page.Content().PaddingTop(10).Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        foreach (var _ in headers) columns.RelativeColumn();
                    });

                    table.Header(header =>
                    {
                        foreach (var h in headers)
                        {
                            header.Cell().Background(Colors.Blue.Darken2).Padding(4)
                                .Text(h).FontColor(Colors.White).SemiBold();
                        }
                    });

                    foreach (var row in rowList)
                    {
                        foreach (var cellText in row)
                        {
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Padding(4).Text(cellText ?? "");
                        }
                    }
                });

                page.Footer().AlignCenter().Text(x =>
                {
                    x.Span("Page ");
                    x.CurrentPageNumber();
                    x.Span(" of ");
                    x.TotalPages();
                });
            });
        });

        return document.GeneratePdf();
    }

    private static byte[] ExportTableToCsvBytes(IReadOnlyList<string> headers, IEnumerable<IReadOnlyList<string>> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", headers.Select(CsvEscape)));
        foreach (var row in rows)
            sb.AppendLine(string.Join(",", row.Select(CsvEscape)));
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    private static string CsvEscape(string? value)
    {
        value ??= "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        return value;
    }
}
