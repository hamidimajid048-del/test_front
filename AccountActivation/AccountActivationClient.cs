namespace Sgb.Trading.Violation.Panel.AccountActivation;

public sealed class AccountActivationClient(HttpClient http, AccountActivationOptions options)
{
    public const string ApiKeyHeader = "APIKey";
    private const int MaxDetailLength = 300;

    public async Task<AccountActivationResultDto> EnableAsync(ulong login, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, options.Url)
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
