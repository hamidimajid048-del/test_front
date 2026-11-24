namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class TelegramSender(IHttpClientFactory httpClientFactory, ILogger<TelegramSender> logger)
{
    public const string HttpClientName = "telegram";
    private const int MaxRetryAfterSeconds = 30;

    public async Task<bool> SendAsync(string token, long chatId, string text, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        var uri = $"https://api.telegram.org/bot{token}/sendMessage";
        var body = new TelegramSendMessageModel(chatId, text);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                using var response = await client.PostAsJsonAsync(uri, body, cancellationToken);
                if (response.IsSuccessStatusCode)
                    return true;

                var description = await response.Content.ReadAsStringAsync(cancellationToken);
                if ((int)response.StatusCode == 429 && attempt == 0)
                {
                    var retryAfter = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(3);
                    await Task.Delay(TimeSpan.FromSeconds(Math.Min(retryAfter.TotalSeconds, MaxRetryAfterSeconds)), cancellationToken);
                    continue;
                }

                logger.LogWarning("Telegram message to {ChatId} failed with status {StatusCode}: {Description}", chatId, (int)response.StatusCode, Trim(description));
                return false;
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning("Telegram message to {ChatId} could not be sent: {Error}", chatId, exception.Message);
                return false;
            }
        }

        return false;
    }

    private static string Trim(string text) => text.Length <= 200 ? text : text[..200];

    private sealed record TelegramSendMessageModel(
        [property: JsonPropertyName("chat_id")] long ChatId,
        [property: JsonPropertyName("text")] string Text)
    {
        [JsonPropertyName("disable_web_page_preview")]
        public bool DisableWebPagePreview => true;
    }
}
