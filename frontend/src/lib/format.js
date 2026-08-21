import { format, formatDistanceToNowStrict } from 'date-fns';

export const inr = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export const compactInr = (n) =>
  new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 1,
  }).format(Number(n) || 0);

export const clock = (d) => format(new Date(d), 'HH:mm:ss');
export const stamp = (d) => format(new Date(d), 'dd MMM yyyy · HH:mm:ss');
export const ago = (d) => formatDistanceToNowStrict(new Date(d), { addSuffix: true });
export const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;
