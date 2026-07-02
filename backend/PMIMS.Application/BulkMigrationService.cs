using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using PMIMS.Domain;

namespace PMIMS.Application;

public class BulkMigrationService : IBulkMigrationService
{
    private readonly IInventoryRepository _repository;

    public BulkMigrationService(IInventoryRepository repository)
    {
        _repository = repository;
    }

    public async Task<dynamic> StageMigrationExcelAsync(string fileName, string fileContentBase64, string uploadedBy)
    {
        byte[] data = Convert.FromBase64String(fileContentBase64);
        string csvContent = Encoding.UTF8.GetString(data);

        var lines = csvContent.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
        
        int totalRecords = 0;
        int validRecords = 0;
        int failedRecords = 0;
        var errorsList = new List<string>();

        var products = (await _repository.GetProductsAsync()).ToList();
        var existingItems = (await _repository.GetItemsAsync()).ToList();
        var locations = (await _repository.GetLocationsAsync()).ToList();

        // Staging items list to insert in staging tables
        var stagedItems = new List<dynamic>();

        // Skip CSV header row
        for (int i = 1; i < lines.Length; i++)
        {
            var row = lines[i].Split(',');
            if (row.Length < 8) continue;

            totalRecords++;
            string serial = row[0].Trim();
            string prodCode = row[1].Trim();
            decimal cost = decimal.TryParse(row[2].Trim(), out decimal c) ? c : 0;
            string vault = row[3].Trim();
            string zone = row[4].Trim();
            string shelf = row[5].Trim();
            string slot = row[6].Trim();
            string owner = row[7].Trim();
            string? civilId = row.Length > 8 ? row[8].Trim() : null;

            bool isValid = true;
            var validationErrors = new List<string>();

            // Validation Rule 1: Duplicate serial numbers check
            if (existingItems.Any(item => item.SerialNumber == serial))
            {
                isValid = false;
                validationErrors.Add($"Serial number '{serial}' already exists in active ledger.");
            }

            // Validation Rule 2: Product code validity
            var product = products.FirstOrDefault(p => p.ProductCode == prodCode);
            if (product == null)
            {
                isValid = false;
                validationErrors.Add($"Product code '{prodCode}' is not registered in catalog.");
            }

            // Validation Rule 3: Coordinate slot capacity and location validity
            var location = locations.FirstOrDefault(l =>
                string.Equals(l.Vault?.VaultName, vault, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(l.ZoneRoom, zone, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(l.ShelfRow, shelf, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(l.SlotBin, slot, StringComparison.OrdinalIgnoreCase));

            if (location == null)
            {
                isValid = false;
                validationErrors.Add($"Coordinate '{vault} -> {zone} -> {shelf} -> {slot}' does not match physical configurations.");
            }
            else if (existingItems.Any(item => item.LocationId == location.LocationId && item.StatusCode != "WITHDRAWN"))
            {
                isValid = false;
                validationErrors.Add($"Coordinate slot '{vault} -> {shelf} -> {slot}' is already occupied by another item.");
            }

            // Validation Rule 4: Ownership type verification
            if (owner != "KFH_OWNED" && owner != "CUSTOMER_OWNED")
            {
                isValid = false;
                validationErrors.Add($"Ownership type must be 'KFH_OWNED' or 'CUSTOMER_OWNED'. Given: '{owner}'");
            }

            if (isValid)
            {
                validRecords++;
            }
            else
            {
                failedRecords++;
                errorsList.Add($"Row {i + 1}: " + string.Join(" | ", validationErrors));
            }

            stagedItems.Add(new
            {
                SerialNumber = serial,
                ProductCode = prodCode,
                AcquisitionCost = cost,
                VaultName = vault,
                ZoneRoom = zone,
                ShelfRow = shelf,
                SlotBin = slot,
                OwnershipType = owner,
                CustomerCivilId = civilId,
                IsValid = isValid,
                Errors = string.Join(" | ", validationErrors)
            });
        }

        // Write to migration staging logs database (we mock this step or insert staging logs in a run summary)
        await _repository.SaveAuditLogAsync(uploadedBy, "DATA_MIGRATION", "UPLOAD", $"Uploaded template '{fileName}'. Total rows: {totalRecords}, Valid: {validRecords}, Errors: {failedRecords}");

        return new
        {
            migration_id = 999, // Staged run ID
            total_records = totalRecords,
            valid_records = validRecords,
            failed_records = failedRecords,
            is_valid = failedRecords == 0,
            errors = errorsList
        };
    }

    public async Task<string> CommitMigrationAsync(int migrationId, string approvedBy)
    {
        // Executes Checker approvals and calls the stored procedure
        string result = await _repository.ImportMigrationDataAsync(migrationId, approvedBy);
        
        await _repository.SaveAuditLogAsync(approvedBy, "DATA_MIGRATION", "COMMIT", $"Approved and committed data migration run ID: {migrationId}. Status: {result}");
        
        return result;
    }
}
