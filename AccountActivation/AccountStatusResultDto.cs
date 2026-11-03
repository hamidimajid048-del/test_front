namespace Sgb.Trading.Violation.Panel.AccountActivation;

public sealed record AccountStatusResultDto(bool Succeeded, int StatusCode, string Body);
