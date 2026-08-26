const BASE_INSTANT_VARIABLE = "ASC_FIXTURE_BASE_INSTANT";

function resolveBaseInstant(): number {
  const injected = process.env[BASE_INSTANT_VARIABLE];
  if (injected !== undefined && injected !== "") {
    const parsed = Date.parse(injected);
    if (Number.isNaN(parsed))
      throw new Error(
        `${BASE_INSTANT_VARIABLE}はISO8601の日時でなければなりません: ${injected}`,
      );
    return parsed;
  }
  return Date.now();
}

const BASE_INSTANT = resolveBaseInstant();

export interface FixtureOffset {
  readonly daysAgo?: number;
  readonly daysAhead?: number;
  readonly hoursAgo?: number;
  readonly hoursAhead?: number;
  readonly minutesAgo?: number;
  readonly minutesAhead?: number;
  readonly secondsAgo?: number;
  readonly secondsAhead?: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function fixtureBaseInstant(): number {
  return BASE_INSTANT;
}

export function fixtureInstantMs(offset: FixtureOffset = {}): number {
  return (
    BASE_INSTANT +
    (offset.daysAhead ?? 0) * DAY -
    (offset.daysAgo ?? 0) * DAY +
    (offset.hoursAhead ?? 0) * HOUR -
    (offset.hoursAgo ?? 0) * HOUR +
    (offset.minutesAhead ?? 0) * MINUTE -
    (offset.minutesAgo ?? 0) * MINUTE +
    (offset.secondsAhead ?? 0) * 1000 -
    (offset.secondsAgo ?? 0) * 1000
  );
}

export function fixtureInstant(offset: FixtureOffset = {}): string {
  return new Date(fixtureInstantMs(offset)).toISOString();
}
