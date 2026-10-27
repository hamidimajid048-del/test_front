namespace Sgb.Trading.Violation.Panel.AccountActivation;

public sealed class AccountActivationOptions
{
    public const string SectionName = "AccountActivation";

    public string Url { get; init; } = string.Empty;

    public string ApiKey { get; init; } = string.Empty;

    public int TimeoutSeconds { get; init; } = 15;

    public bool IsConfigured => Url.Length > 0 && ApiKey.Length > 0;

    public AccountActivationOptions Validate()
    {
        if (Url.Length == 0 && ApiKey.Length == 0)
            return this;

        List<string> failures = [];
        if (!Uri.TryCreate(Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            failures.Add($"{SectionName}:Url must be an absolute http(s) address.");
        if (ApiKey.Length == 0)
            failures.Add($"{SectionName}:ApiKey is required when {SectionName}:Url is set.");
        if (TimeoutSeconds is < 1 or > 120)
            failures.Add($"{SectionName}:TimeoutSeconds must be 1-120.");

        return failures.Count == 0 ? this : throw new InvalidOperationException(string.Join(" ", failures));
    }
}
