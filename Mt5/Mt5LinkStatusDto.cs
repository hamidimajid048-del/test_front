namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5LinkStatusDto(
    bool Connected, string? Server, DateTimeOffset? ConnectedAt, DateTimeOffset? LastCheckAt, string? LastError);
