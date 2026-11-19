// Date range controls shared by the pages that filter by a UTC range (a preset or a custom range): of whole days with
// date inputs, or to the millisecond with datetime-local inputs.
// The form needs the fields: range (select), fromUtc and toUtc (date or datetime-local inputs).

// Quick ranges ending now (UTC); each moves the start date back.
const RANGE_PRESETS = {
  day: date => date.setUTCDate(date.getUTCDate() - 1),
  week: date => date.setUTCDate(date.getUTCDate() - 7),
  month: date => date.setUTCMonth(date.getUTCMonth() - 1),
  '3months': date => date.setUTCMonth(date.getUTCMonth() - 3),
  '6months': date => date.setUTCMonth(date.getUTCMonth() - 6),
  year: date => date.setUTCFullYear(date.getUTCFullYear() - 1),
};

// Date input value ("yyyy-MM-dd") of a Date, in UTC.
const toDayValue = date => date.toISOString().slice(0, 10);

// The value of a range input for a Date, in UTC: the day, or the time to the millisecond for a datetime-local input.
const rangeInputValue = (input, date) => (input.type === 'datetime-local' ? date.toISOString().slice(0, 23) : toDayValue(date));

// The range is whole UTC days ("yyyy-MM-dd"): from the start of the first day to the end of the last day.
const fromDayParam = day => (day ? `${day}T00:00:00Z` : undefined);
const toDayParam = day => (day ? `${day}T23:59:59.9999999Z` : undefined);

// Throws an ApiError with field errors when the range is half-filled or reversed.
function validateRange(values) {
  const missing = 'The date range is incomplete: fill in both From and To, or leave both empty';
  if (values.fromUtc && !values.toUtc) throw new ApiError(missing, { toUtc: ['Fill in To'] });
  if (!values.fromUtc && values.toUtc) throw new ApiError(missing, { fromUtc: ['Fill in From'] });
  if (values.fromUtc && values.fromUtc > values.toUtc) {
    throw new ApiError('From must not be after To', { fromUtc: ['From is after To'] });
  }
}

// Wires the preset select to the day inputs. The day inputs are editable only for a custom range; otherwise they are
// read-only (not disabled), so a preset's days are still shown and submitted with the form.
function initRangeControls(form) {
  // A day field whose calendar icon stands in front of it opens the picker on a click anywhere in it.
  for (const input of form.querySelectorAll('.date-field input'))
    input.addEventListener('click', () => { if (!input.disabled && !input.readOnly) input.showPicker?.(); });

  function setRange(fromValue, toValue) {
    form.elements.fromUtc.value = fromValue;
    form.elements.toUtc.value = toValue;
  }

  function sync() {
    const custom = form.elements.range.value === 'custom';
    for (const name of ['fromUtc', 'toUtc']) {
      form.elements[name].readOnly = !custom;
      form.elements[name].title = custom ? '' : 'Select the "Custom" range to pick the range';
    }
  }

  function apply() {
    sync();
    const preset = form.elements.range.value;
    if (preset === 'custom') return;
    if (!preset) {
      setRange('', '');
      return;
    }
    const to = new Date();
    const from = new Date(to);
    RANGE_PRESETS[preset](from);
    setRange(rangeInputValue(form.elements.fromUtc, from), rangeInputValue(form.elements.toUtc, to));
  }

  // A link that carries day inputs but no preset (an older or hand-made link) is a custom range.
  function restore() {
    if (!form.elements.range.value && form.elements.fromUtc.value) form.elements.range.value = 'custom';
    sync();
  }

  form.elements.range.addEventListener('change', apply);
  return { setRange, sync, apply, restore };
}
