namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5ChangeEntryDto(long Id, DateTime OccurredAt, string Action, bool Succeeded, string? Detail, string? Username, string? IpAddress);
