namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5AccountSwitchInput(ulong Login, string? Switch, bool? Enabled);
