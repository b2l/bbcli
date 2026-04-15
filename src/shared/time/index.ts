const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Formats a timestamp relative to `now`. Designed for terse column display
 * ("2h ago", "3d ago") rather than prose. Future timestamps (clock skew)
 * collapse to "just now" rather than returning a negative duration.
 */
export function formatRelativeTime(
	iso: string,
	now: Date = new Date(),
): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const diff = now.getTime() - then;
	if (diff < MINUTE) return "just now";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
	if (diff < MONTH) return `${Math.floor(diff / DAY)}d ago`;
	if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
	return `${Math.floor(diff / YEAR)}y ago`;
}
