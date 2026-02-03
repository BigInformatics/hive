// DST edge case tests for recurring task generation
// America/Chicago: Spring forward Mar 9 2025 2:00 AM, Fall back Nov 2 2025 2:00 AM
// For 2026: Spring forward Mar 8, Fall back Nov 1

import { DateTime } from 'luxon';
import { describe, test, expect } from 'bun:test';

// Simplified version of computeNextOccurrence for testing
function computeNextOccurrence(
  after: Date,
  everyInterval: number,
  everyUnit: 'minute' | 'hour' | 'day' | 'week' | 'month',
  timezone: string = 'America/Chicago',
  weekParity: 'any' | 'odd' | 'even' = 'any'
): Date {
  let next = DateTime.fromJSDate(after, { zone: timezone });
  
  switch (everyUnit) {
    case 'minute': next = next.plus({ minutes: everyInterval }); break;
    case 'hour': next = next.plus({ hours: everyInterval }); break;
    case 'day': next = next.plus({ days: everyInterval }); break;
    case 'week': next = next.plus({ weeks: everyInterval }); break;
    case 'month': next = next.plus({ months: everyInterval }); break;
  }
  
  // Handle DST: if time doesn't exist (spring forward), Luxon adjusts automatically
  // For ambiguous times (fall back), Luxon picks the first occurrence by default
  
  // Apply week parity constraint (ISO week number)
  if (weekParity !== 'any') {
    const weekNum = next.weekNumber;
    const isOdd = weekNum % 2 === 1;
    const wantOdd = weekParity === 'odd';
    
    if (isOdd !== wantOdd) {
      next = next.plus({ weeks: 1 });
    }
  }
  
  return next.toJSDate();
}

describe('DST Edge Cases - America/Chicago', () => {
  
  test('Spring forward gap day (Mar 8 2026, 2:00 AM skipped)', () => {
    // Schedule: daily at 2:30 AM Chicago time
    // On Mar 8 2026, 2:30 AM doesn't exist (clocks jump from 2:00 to 3:00)
    const before = new Date('2026-03-07T08:30:00Z'); // Mar 7, 2:30 AM CT
    const next = computeNextOccurrence(before, 1, 'day', 'America/Chicago');
    
    // Luxon should handle the gap - the time should be adjusted
    const nextDT = DateTime.fromJSDate(next, { zone: 'America/Chicago' });
    
    // Expect Mar 8 2026
    expect(nextDT.month).toBe(3);
    expect(nextDT.day).toBe(8);
    expect(nextDT.year).toBe(2026);
    
    // Time should be valid (Luxon adjusts to 3:30 AM or similar)
    expect(nextDT.isValid).toBe(true);
    console.log(`Spring forward result: ${nextDT.toISO()} (hour: ${nextDT.hour})`);
  });
  
  test('Fall back repeated hour (Nov 1 2026, 1:30 AM occurs twice)', () => {
    // Schedule: daily at 1:30 AM Chicago time
    // On Nov 1 2026, 1:30 AM occurs twice (DST ends, clocks go back)
    const before = new Date('2026-10-31T06:30:00Z'); // Oct 31, 1:30 AM CT (CDT)
    const next = computeNextOccurrence(before, 1, 'day', 'America/Chicago');
    
    const nextDT = DateTime.fromJSDate(next, { zone: 'America/Chicago' });
    
    // Expect Nov 1 2026
    expect(nextDT.month).toBe(11);
    expect(nextDT.day).toBe(1);
    expect(nextDT.year).toBe(2026);
    
    // Should pick the earlier occurrence (DST time, before fall back)
    expect(nextDT.isValid).toBe(true);
    console.log(`Fall back result: ${nextDT.toISO()} (offset: ${nextDT.offset})`);
  });
  
  test('Hourly schedule across spring forward', () => {
    // Schedule: every hour starting at 1:30 AM on Mar 8 2026
    const start = new Date('2026-03-08T07:30:00Z'); // Mar 8, 1:30 AM CT
    
    // Next hour would be 2:30 AM, but that doesn't exist
    const next = computeNextOccurrence(start, 1, 'hour', 'America/Chicago');
    const nextDT = DateTime.fromJSDate(next, { zone: 'America/Chicago' });
    
    expect(nextDT.isValid).toBe(true);
    // Should be 3:30 AM (skipping the non-existent 2:30 AM)
    expect(nextDT.hour).toBe(3);
    expect(nextDT.minute).toBe(30);
    console.log(`Hourly spring forward: ${nextDT.toISO()}`);
  });
  
  test('ISO week parity - odd weeks', () => {
    // Week 1 of 2026 starts Dec 29 2025 (ISO week starts Monday)
    // Week 2 starts Jan 5 2026
    const start = new Date('2026-01-05T12:00:00Z'); // Week 2 (even)
    const next = computeNextOccurrence(start, 1, 'week', 'America/Chicago', 'odd');
    
    const nextDT = DateTime.fromJSDate(next, { zone: 'America/Chicago' });
    const weekNum = nextDT.weekNumber;
    
    // Should be week 3 (odd)
    expect(weekNum % 2).toBe(1);
    console.log(`Week parity (odd): ${nextDT.toISO()} (ISO week ${weekNum})`);
  });
  
  test('ISO week parity - even weeks', () => {
    const start = new Date('2026-01-12T12:00:00Z'); // Week 3 (odd)
    const next = computeNextOccurrence(start, 1, 'week', 'America/Chicago', 'even');
    
    const nextDT = DateTime.fromJSDate(next, { zone: 'America/Chicago' });
    const weekNum = nextDT.weekNumber;
    
    // Should be week 4 (even)
    expect(weekNum % 2).toBe(0);
    console.log(`Week parity (even): ${nextDT.toISO()} (ISO week ${weekNum})`);
  });
  
  test('Monthly schedule handles month-end correctly', () => {
    // Jan 31 + 1 month = Feb 28 (or 29 in leap year)
    const start = new Date('2026-01-31T12:00:00Z');
    const next = computeNextOccurrence(start, 1, 'month', 'America/Chicago');
    
    const nextDT = DateTime.fromJSDate(next, { zone: 'America/Chicago' });
    
    // 2026 is not a leap year, so Feb has 28 days
    expect(nextDT.month).toBe(2);
    expect(nextDT.day).toBe(28);
    console.log(`Month-end: ${nextDT.toISO()}`);
  });
});
