/** Duration parsing so a single env value can drive both JWT expiry and cookie maxAge. */
const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** `"15m" | "12h" | "30d" | 900` -> seconds. Throws on nonsense so misconfig fails fast. */
export function durationSeconds(input: string | number): number {
    if (typeof input === 'number') return Math.floor(input);
    const match = /^(\d+)\s*([smhd])?$/.exec(String(input).trim());
    if (!match) throw new Error(`Invalid duration: ${input}`);
    const value = Number(match[1]);
    const unit = match[2] ? UNITS[match[2]] : 1;
    if (!unit) throw new Error(`Invalid duration unit: ${input}`);
    return value * unit;
}

export function addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
}

/** Start of the UTC day `n` days ago — the default window for timeseries queries. */
export function daysAgoStart(days: number, now = new Date()): Date {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
}

/** ISO-8601 week bucket key (e.g. `2026-W44`) used by the throughput chart. */
export function weekKey(date: Date): string {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}
