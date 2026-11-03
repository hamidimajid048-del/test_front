namespace Sgb.Trading.Violation.Panel.AccountActivation;

public sealed class AccountActivationClient(HttpClient http, AccountActivationOptions options)
{
    public const string ApiKeyHeader = "APIKey";
    private const int MaxDetailLength = 300;

    public async Task<AccountStatusResultDto> GetStatusAsync(ulong login, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, options.StatusUrl.Replace("{login}", login.ToString(CultureInfo.InvariantCulture)));
        request.Headers.TryAddWithoutValidation(ApiKeyHeader, options.ApiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        return new AccountStatusResultDto(
            response.IsSuccessStatusCode, (int)response.StatusCode, await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public async Task<AccountActivationResultDto> SetAsync(ulong login, bool enabled, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, enabled ? options.Url : options.DisableUrl)
        {
            Content = JsonContent.Create(new Dictionary<string, ulong[]> { ["Logins"] = [login] })
        };
        request.Headers.TryAddWithoutValidation(ApiKeyHeader, options.ApiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        var body = (await response.Content.ReadAsStringAsync(cancellationToken)).Trim();
        return new AccountActivationResultDto(
            response.IsSuccessStatusCode,
            (int)response.StatusCode,
            body.Length > MaxDetailLength ? body[..MaxDetailLength] : body);
    }
}
