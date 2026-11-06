export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/** Local-time greeting bucket: 05–11 morning, 12–16 afternoon, 17–21 evening, otherwise night. */
export function greetingPeriod(date: Date): GreetingPeriod {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}
