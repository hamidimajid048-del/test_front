namespace Sgb.Trading.Violation.Panel.AccountActivation;

public sealed record AccountActivationResultDto(bool Succeeded, int StatusCode, string Detail);
