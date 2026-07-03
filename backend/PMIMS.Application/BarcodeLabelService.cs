using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using PMIMS.Domain;
using ZXing;
using ZXing.Common;
using ZXing.OneD;
using ZXing.QrCode;
using ZXing.QrCode.Internal;

namespace PMIMS.Application;

// ============================================================
// Barcode/QR Code Tracking (RFP Section 3): assigns a unique GS1-128 barcode +
// ISO/IEC 18004 QR code to every serialized bar (InventoryItem), built from
// Application Identifiers (01) product code, (10) lot/batch, (21) serial number.
//
// Encoding is done with ZXing.Net (pure managed, no native image dependency --
// see PMIMS.Application.csproj) down to a BitMatrix, which we render to SVG
// ourselves (RenderSvg) rather than pulling in SkiaSharp/System.Drawing. That
// keeps this cross-platform: no native asset packages to get wrong for a Linux
// deployment target, and SVG scales cleanly for label printing at any DPI.
//
// Honesty note on GS1 compliance: the (01) value here is a structurally valid,
// checksum-correct GTIN-14 (see ComputeGtin14) built under GS1's "Restricted
// Circulation Number within a company" reserved range (leading digit 2), which is
// the correct provision for an internal numbering scheme that hasn't yet been
// assigned a real GS1 Company Prefix. Swap in KFH's assigned prefix once GS1
// membership is in place -- that's a registration/business step, not a code change.
// ============================================================
public class BarcodeLabelService : IBarcodeLabelService
{
    private readonly IInventoryRepository _repository;

    public BarcodeLabelService(IInventoryRepository repository)
    {
        _repository = repository;
    }

    public async Task<BarcodeLabelDto?> GenerateItemLabelAsync(string serialNumber)
    {
        var item = await _repository.GetItemBySerialNumberAsync(serialNumber);
        return item == null ? null : MapToDto(item);
    }

    public async Task<BarcodeLabelDto?> GenerateItemLabelByIdAsync(int itemId)
    {
        var item = await _repository.GetItemByIdWithDetailsAsync(itemId);
        return item == null ? null : MapToDto(item);
    }

    public async Task<LotLabelSheetDto?> GenerateLotLabelSheetAsync(string lotNumber)
    {
        var lot = await _repository.GetLotByNumberAsync(lotNumber);
        if (lot == null) return null;

        var items = await _repository.GetItemsByLotIdAsync(lot.LotId);
        return new LotLabelSheetDto
        {
            LotId = lot.LotId,
            LotNumber = lot.LotNumber,
            VendorName = lot.Vendor?.VendorName,
            AcquisitionDate = lot.AcquisitionDate,
            Labels = items.Select(MapToDto).ToList()
        };
    }

    // ------------------------------------------------------------------------
    // Mapping
    // ------------------------------------------------------------------------
    private static BarcodeLabelDto MapToDto(InventoryItem item)
    {
        var gtin14 = ComputeGtin14(item.ProductId);
        var lotNumber = item.Lot?.LotNumber;
        var elementString = BuildGs1ElementString(gtin14, lotNumber, item.SerialNumber);
        var humanReadable = BuildHumanReadable(gtin14, lotNumber, item.SerialNumber);

        var productLabel = $"{item.Product?.MetalType?.MetalName} {item.Product?.Denomination?.Label}".Trim();
        if (item.Product?.Purity != null)
        {
            productLabel += $" ({item.Product.Purity.PurityValue})";
        }

        return new BarcodeLabelDto
        {
            ItemId = item.ItemId,
            SerialNumber = item.SerialNumber,
            ProductLabel = productLabel,
            Gtin14 = gtin14,
            LotNumber = lotNumber,
            OwnershipType = item.OwnershipType,
            StatusCode = item.StatusCode,
            LocationDescription = item.Location?.Description,
            Gs1ElementString = elementString,
            Gs1HumanReadable = humanReadable,
            BarcodeSvg = BuildGs1BarcodeSvg(elementString),
            QrCodeSvg = BuildQrCodeSvg(humanReadable)
        };
    }

    // ------------------------------------------------------------------------
    // GTIN-14 (GS1 Application Identifier 01)
    // ------------------------------------------------------------------------
    private static string ComputeGtin14(int productId)
    {
        // 14 digits = indicator/prefix digit (1) + company-prefix-and-item-reference (12) + check digit (1).
        // Leading "2" places this in GS1's reserved 200-299 "restricted circulation, internal use" range.
        var base13 = "2" + productId.ToString().PadLeft(12, '0');
        var check = ComputeGtinCheckDigit(base13);
        return base13 + check;
    }

    // Standard GTIN mod-10 check digit: from the rightmost digit, alternate weights 3,1,3,1...
    private static int ComputeGtinCheckDigit(string base13)
    {
        var sum = 0;
        for (var i = 0; i < base13.Length; i++)
        {
            var digit = base13[base13.Length - 1 - i] - '0';
            var weight = (i % 2 == 0) ? 3 : 1;
            sum += digit * weight;
        }
        return (10 - (sum % 10)) % 10;
    }

    // ------------------------------------------------------------------------
    // GS1 element string (what actually gets encoded into the GS1-128 symbol)
    // ------------------------------------------------------------------------
    // FNC1 stand-in ZXing.Net's Code128Writer recognizes inside its input string
    // (ZXing.OneD.Code128Writer.ESCAPE_FNC_1). Passing EncodeHintType.GS1_FORMAT=true
    // additionally prepends a leading FNC1 automatically, marking the whole symbol as GS1-128.
    private const char Fnc1 = 'ñ';

    private static string BuildGs1ElementString(string gtin14, string? lotNumber, string serialNumber)
    {
        var sb = new StringBuilder();
        sb.Append("01").Append(gtin14); // AI(01): fixed-length 14 numeric -- no separator needed after it
        if (!string.IsNullOrWhiteSpace(lotNumber))
        {
            // AI(10): variable-length -- must be FNC1-terminated since another AI follows
            sb.Append("10").Append(lotNumber).Append(Fnc1);
        }
        sb.Append("21").Append(serialNumber); // AI(21): variable-length, last element, no trailing separator
        return sb.ToString();
    }

    // Printable "human readable interpretation" line for underneath the barcode/QR.
    private static string BuildHumanReadable(string gtin14, string? lotNumber, string serialNumber)
    {
        var sb = new StringBuilder();
        sb.Append("(01)").Append(gtin14);
        if (!string.IsNullOrWhiteSpace(lotNumber))
        {
            sb.Append("(10)").Append(lotNumber);
        }
        sb.Append("(21)").Append(serialNumber);
        return sb.ToString();
    }

    // ------------------------------------------------------------------------
    // Symbol generation (ZXing.Net BitMatrix -> SVG)
    // ------------------------------------------------------------------------
    private static string BuildGs1BarcodeSvg(string elementString)
    {
        var writer = new Code128Writer();
        var hints = new Dictionary<EncodeHintType, object>
        {
            { EncodeHintType.GS1_FORMAT, true },
            { EncodeHintType.MARGIN, 10 }
        };
        var matrix = writer.encode(elementString, BarcodeFormat.CODE_128, 600, 120, hints);
        return RenderSvg(matrix);
    }

    private static string BuildQrCodeSvg(string humanReadableContent)
    {
        var writer = new QRCodeWriter();
        var hints = new Dictionary<EncodeHintType, object>
        {
            { EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M },
            { EncodeHintType.MARGIN, 1 }
        };
        var matrix = writer.encode(humanReadableContent, BarcodeFormat.QR_CODE, 220, 220, hints);
        return RenderSvg(matrix);
    }

    // Renders a ZXing BitMatrix as a compact SVG: one <rect> per contiguous run of
    // "on" modules per row, instead of one per module (keeps QR-code SVGs small).
    // The matrix is already at final pixel resolution (the writers scale internally
    // to the requested width/height), so each matrix cell maps to exactly one SVG unit.
    private static string RenderSvg(BitMatrix matrix)
    {
        int width = matrix.Width;
        int height = matrix.Height;
        var sb = new StringBuilder();
        sb.Append("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ")
          .Append(width).Append(' ').Append(height)
          .Append("\" shape-rendering=\"crispEdges\">");
        sb.Append("<rect width=\"100%\" height=\"100%\" fill=\"#FFFFFF\"/>");

        for (var y = 0; y < height; y++)
        {
            var runStart = -1;
            for (var x = 0; x <= width; x++)
            {
                var on = x < width && matrix[x, y];
                if (on && runStart < 0)
                {
                    runStart = x;
                }
                if (!on && runStart >= 0)
                {
                    sb.Append("<rect x=\"").Append(runStart).Append("\" y=\"").Append(y)
                      .Append("\" width=\"").Append(x - runStart).Append("\" height=\"1\" fill=\"#000000\"/>");
                    runStart = -1;
                }
            }
        }

        sb.Append("</svg>");
        return sb.ToString();
    }
}
