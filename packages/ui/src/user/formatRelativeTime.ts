/** "just now", "4 min ago", "3 h ago", "2 days ago", then a short date. */
export function formatRelativeTime(millis: number, now = Date.now()): string {
  if (!millis) return '';
  const seconds = Math.max(0, Math.round((now - millis) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(millis).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
}
