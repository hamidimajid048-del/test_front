namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5Options
{
    public const string SectionName = "Mt5";

    public bool Enabled { get; init; }

    public string Server { get; init; } = string.Empty;

    public ulong Login { get; init; }

    public string Password { get; init; } = string.Empty;

    public int ConnectTimeoutSeconds { get; init; } = 30;

    public int HealthCheckSeconds { get; init; } = 15;

    public Mt5Options Validate()
    {
        if (!Enabled)
            return this;

        List<string> failures = [];
        if (string.IsNullOrWhiteSpace(Server))
            failures.Add("Server is required");
        if (Login == 0)
            failures.Add("Login is required");
        if (string.IsNullOrEmpty(Password))
            failures.Add("Password is required");
        if (ConnectTimeoutSeconds is < 1 or > 300)
            failures.Add("ConnectTimeoutSeconds must be between 1 and 300");
        if (HealthCheckSeconds is < 5 or > 600)
            failures.Add("HealthCheckSeconds must be between 5 and 600");

        return failures.Count == 0
            ? this
            : throw new InvalidOperationException($"{SectionName} is invalid: {string.Join("; ", failures)}.");
    }
}
