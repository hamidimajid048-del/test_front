namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5SwitchChangeDto(string Switch, bool Enabled, string? Username, DateTime OccurredAt);
