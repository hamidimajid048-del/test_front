namespace Sgb.Trading.Violation.Panel.TickMonitor;

public static class TickMonitorProfileValidator
{
    public const int MaxSymbolLength = 32;
    public const int MaxScheduleNameLength = 40;
    public const int MaxSchedules = 12;
    public const int MaxStages = 10;
    public const int MaxCloseLeadSeconds = 3600;
    public const int MaxAfterSeconds = 86_400;
    public const int MaxRepeatIntervalSeconds = 86_400;

    public static string? Validate(TickMonitorProfileInput input, TickMonitorSettings settings, IReadOnlyCollection<TickMonitorChannel> channels)
    {
        var symbol = input.Symbol?.Trim() ?? string.Empty;
        if (symbol.Length is 0 or > MaxSymbolLength)
            return $"A symbol has 1 to {MaxSymbolLength} characters.";
        if (input.Config is not { } config)
            return "The profile has no configuration.";
        if (config.CloseLeadSeconds is < 0 or > MaxCloseLeadSeconds)
            return $"Close lead must be between 0 and {MaxCloseLeadSeconds} seconds.";
        if (config.RecoveryNotice is null)
            return "The recovery notice is missing.";
        if (config.RecoveryNotice.MinStagesFired is < 1 or > MaxStages)
            return $"Recovery notice stages must be between 1 and {MaxStages}.";
        if (config.RecoveryNotice.ChannelId is { } recoveryChannel && channels.All(channel => channel.Id != recoveryChannel))
            return "The recovery notice channel does not exist.";
        if (config.Schedules is null || config.Schedules.Length is 0 or > MaxSchedules)
            return $"A profile has 1 to {MaxSchedules} time windows.";

        foreach (var schedule in config.Schedules)
        {
            if (ValidateSchedule(schedule, settings, channels) is { } error)
                return error;
        }

        for (var first = 0; first < config.Schedules.Length; first++)
            for (var second = first + 1; second < config.Schedules.Length; second++)
                if (config.Schedules[first].Overlaps(config.Schedules[second]))
                    return $"Time windows \"{config.Schedules[first].Name}\" and \"{config.Schedules[second].Name}\" overlap.";

        return null;
    }

    private static string? ValidateSchedule(TickMonitorSchedule schedule, TickMonitorSettings settings, IReadOnlyCollection<TickMonitorChannel> channels)
    {
        var name = schedule.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > MaxScheduleNameLength)
            return $"A time window name has 1 to {MaxScheduleNameLength} characters.";
        if (schedule.Days is null || schedule.Days.Length == 0)
            return $"Time window \"{name}\" has no days.";
        if (schedule.Days.Distinct().Count() != schedule.Days.Length)
            return $"Time window \"{name}\" repeats a day.";
        if (TickMonitorSchedule.ParseMinutes(schedule.From ?? string.Empty) < 0 || TickMonitorSchedule.ParseMinutes(schedule.To ?? string.Empty) < 0)
            return $"Time window \"{name}\" needs times as HH:mm.";
        if (schedule.Stages is null || schedule.Stages.Length is 0 or > MaxStages)
            return $"Time window \"{name}\" has 1 to {MaxStages} stages.";

        var previousAfter = -1;
        foreach (var stage in schedule.Stages)
        {
            if (stage.AfterSeconds < settings.MinAfterSeconds || stage.AfterSeconds > MaxAfterSeconds)
                return $"A stage delay must be between {settings.MinAfterSeconds} and {MaxAfterSeconds} seconds.";
            if (stage.AfterSeconds < previousAfter)
                return $"Stages of \"{name}\" must be ordered by their delay.";
            if (stage.RepeatCount < 1 || stage.RepeatCount > settings.MaxRepeatCount)
                return $"A stage repeats 1 to {settings.MaxRepeatCount} times.";
            if (stage.RepeatCount > 1 && (stage.RepeatIntervalSeconds < settings.MinRepeatIntervalSeconds || stage.RepeatIntervalSeconds > MaxRepeatIntervalSeconds))
                return $"A repeat interval must be between {settings.MinRepeatIntervalSeconds} and {MaxRepeatIntervalSeconds} seconds.";
            if (channels.All(channel => channel.Id != stage.ChannelId))
                return $"A stage of \"{name}\" points to a channel that does not exist.";
            previousAfter = stage.AfterSeconds;
        }

        return null;
    }
}
