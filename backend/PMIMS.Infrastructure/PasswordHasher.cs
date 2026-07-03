using System;
using System.Security.Cryptography;
using System.Text;

namespace PMIMS.Infrastructure;

// ============================================================
// Password hashing/encryption utility shared by ActiveDirectoryService
// (login verification) and FimService (FIM SetPassword function).
//
// Supports three algorithms, tagged on AppUser.PasswordAlgorithm so
// verification always dispatches correctly regardless of how a given
// account's credential was set:
//   - "SHA256"  legacy demo-seed default (DbSeeder), kept for backward
//               compatibility with existing seeded accounts -- do not use
//               for new credentials.
//   - "BCRYPT"  FIM SetPassword default per the RFP ("provide AES-256 or
//               bcrypt as default"). One-way, salted, adaptive cost.
//   - "AES256"  reversible encryption option (RFP explicitly allows this
//               as an alternative to bcrypt) for scenarios where a
//               downstream system needs the recoverable plaintext, e.g.
//               pushing a generated credential into a legacy core system
//               during provisioning. Key is loaded from configuration
//               (Fim:AesKey) -- see appsettings.json; NEVER hard-code a
//               production key.
// ============================================================
public static class PasswordHasher
{
    public const string AlgorithmBcrypt = "BCRYPT";
    public const string AlgorithmAes256 = "AES256";
    public const string AlgorithmSha256 = "SHA256"; // legacy only

    /// <summary>
    /// Hashes/encrypts a plaintext password per the requested algorithm.
    /// Returns the value to persist in AppUser.PasswordHash; caller is
    /// responsible for also setting AppUser.PasswordAlgorithm to the same
    /// (normalized) algorithm name.
    /// </summary>
    public static string Hash(string plaintextPassword, string algorithm, string? aesKey = null)
    {
        switch (Normalize(algorithm))
        {
            case AlgorithmBcrypt:
                return BCrypt.Net.BCrypt.HashPassword(plaintextPassword, workFactor: 11);
            case AlgorithmAes256:
                return EncryptAes256(plaintextPassword, ResolveAesKey(aesKey));
            case AlgorithmSha256:
                return ComputeSha256(plaintextPassword);
            default:
                throw new NotSupportedException($"Unsupported password encryption algorithm '{algorithm}'. Supported: BCRYPT (default), AES256, SHA256 (legacy).");
        }
    }

    /// <summary>
    /// Verifies a plaintext password against a stored hash/ciphertext,
    /// dispatching on the algorithm the credential was stored with.
    /// </summary>
    public static bool Verify(string plaintextPassword, string storedHash, string algorithm, string? aesKey = null)
    {
        switch (Normalize(algorithm))
        {
            case AlgorithmBcrypt:
                try { return BCrypt.Net.BCrypt.Verify(plaintextPassword, storedHash); }
                catch (BCrypt.Net.SaltParseException) { return false; }
            case AlgorithmAes256:
                try { return DecryptAes256(storedHash, ResolveAesKey(aesKey)) == plaintextPassword; }
                catch { return false; }
            case AlgorithmSha256:
            default:
                // Default/fallback matches the legacy behavior every seeded
                // demo account and pre-existing user relies on.
                return ComputeSha256(plaintextPassword) == storedHash;
        }
    }

    public static string Normalize(string? algorithm) =>
        string.IsNullOrWhiteSpace(algorithm) ? AlgorithmBcrypt : algorithm.Trim().ToUpperInvariant();

    private static string ComputeSha256(string input)
    {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    // AES-256-CBC with a random IV per call, stored as base64("IV||ciphertext").
    private static string EncryptAes256(string plaintext, byte[] key)
    {
        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.Key = key;
        aes.GenerateIV();
        using var encryptor = aes.CreateEncryptor();
        var plainBytes = Encoding.UTF8.GetBytes(plaintext);
        var cipherBytes = encryptor.TransformFinalBlock(plainBytes, 0, plainBytes.Length);

        var combined = new byte[aes.IV.Length + cipherBytes.Length];
        Buffer.BlockCopy(aes.IV, 0, combined, 0, aes.IV.Length);
        Buffer.BlockCopy(cipherBytes, 0, combined, aes.IV.Length, cipherBytes.Length);
        return Convert.ToBase64String(combined);
    }

    private static string DecryptAes256(string base64Combined, byte[] key)
    {
        var combined = Convert.FromBase64String(base64Combined);
        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.Key = key;

        int ivLength = aes.BlockSize / 8; // 16 bytes for AES
        var iv = new byte[ivLength];
        Buffer.BlockCopy(combined, 0, iv, 0, ivLength);
        aes.IV = iv;

        int cipherLength = combined.Length - ivLength;
        using var decryptor = aes.CreateDecryptor();
        var plainBytes = decryptor.TransformFinalBlock(combined, ivLength, cipherLength);
        return Encoding.UTF8.GetString(plainBytes);
    }

    // Dev-only fallback key, mirroring the Jwt:Key pattern in appsettings.json.
    // MUST be overridden via Fim:AesKey (configuration/secret store) before
    // any real deployment that uses the AES-256 password option.
    private const string DevOnlyAesKeyMaterial = "dev-only-pmims-fim-aes256-key-change-me-32b!!";

    private static byte[] ResolveAesKey(string? configuredKey)
    {
        string material = string.IsNullOrWhiteSpace(configuredKey) ? DevOnlyAesKeyMaterial : configuredKey;
        // Derive exactly 32 bytes (AES-256) regardless of input string length via SHA-256.
        using var sha = SHA256.Create();
        return sha.ComputeHash(Encoding.UTF8.GetBytes(material));
    }
}
