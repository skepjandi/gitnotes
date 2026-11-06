import { greetingPeriod } from '../../src/utils/greeting';

const at = (hour: number, minute = 0) => new Date(2026, 10, 7, hour, minute);

describe('greetingPeriod', () => {
  it.each([
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'night'],
    [0, 'night'],
    [4, 'night'],
  ])('maps hour %i to %s', (hour, period) => {
    expect(greetingPeriod(at(hour, 59))).toBe(period);
  });
});
