namespace Sgb.Trading.Violation.Panel.Mt5;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum Mt5AccountSourceEnum
{
    Manager,
    Archive,
    NotFound,
    Unavailable
}
