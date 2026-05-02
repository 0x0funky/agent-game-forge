// Adapted verbatim from designer's icons.jsx — colors come via currentColor
// or the inline oklch() values that are theme-aware.
import type { ReactElement } from 'react';

export const I: Record<string, ReactElement> = {
  caret: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2.5 4 L5 6.5 L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  caretRight: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M4 2.5 L6.5 5 L4 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
      <path d="M3 2 L9 5.5 L3 9 Z" />
    </svg>
  ),
  stop: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <rect x="2" y="2" width="6" height="6" rx="1" />
    </svg>
  ),
  build: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11 L8 6 M6 4 L10 8 M9 3 L11 5 L8 8 L6 6 Z" />
    </svg>
  ),
  send: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7 L12 2 L8 12 L6.5 8 L2 7 Z" />
    </svg>
  ),
  folder: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 4 a1 1 0 0 1 1-1 h2.5 l1 1 H11 a1 1 0 0 1 1 1 V10 a1 1 0 0 1-1 1 H3 a1 1 0 0 1-1-1 Z" fill="oklch(0.78 0.16 var(--accent-h) / 0.18)" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="1" />
    </svg>
  ),
  folderOpen: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 4.5 a1 1 0 0 1 1-1 h2.5 l1 1 H11 a1 1 0 0 1 1 1 V6 H2 Z" fill="oklch(0.78 0.16 var(--accent-h) / 0.3)" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="1" />
      <path d="M2 6 H12 L11 11 a1 1 0 0 1-1 1 H3 a1 1 0 0 1-1-1 Z" fill="oklch(0.78 0.16 var(--accent-h) / 0.12)" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="1" />
    </svg>
  ),
  png: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="oklch(0.72 0.15 305 / 0.18)" stroke="oklch(0.72 0.15 305)" strokeWidth="0.9" />
      <circle cx="4.5" cy="5" r="0.9" fill="oklch(0.72 0.15 305)" />
      <path d="M2 9 L5 6.5 L7 8 L9 6 L10 9" stroke="oklch(0.72 0.15 305)" strokeWidth="0.9" fill="none" />
    </svg>
  ),
  sheet: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="oklch(0.78 0.16 var(--accent-h) / 0.18)" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="0.9" />
      <line x1="6" y1="2" x2="6" y2="10" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="0.6" />
      <line x1="2" y1="6" x2="10" y2="6" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="0.6" />
    </svg>
  ),
  json: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="oklch(0.78 0.15 150 / 0.15)" stroke="oklch(0.78 0.15 150)" strokeWidth="0.9" />
      <text x="6" y="8" fontSize="5" fill="oklch(0.78 0.15 150)" textAnchor="middle" fontFamily="monospace">{'{}'}</text>
    </svg>
  ),
  tscn: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="3" cy="3" r="1.4" fill="oklch(0.75 0.13 240)" />
      <circle cx="9" cy="3" r="1.4" fill="oklch(0.75 0.13 240 / 0.6)" />
      <circle cx="6" cy="9" r="1.4" fill="oklch(0.75 0.13 240 / 0.6)" />
      <line x1="3" y1="3" x2="6" y2="9" stroke="oklch(0.75 0.13 240)" strokeWidth="0.7" />
      <line x1="9" y1="3" x2="6" y2="9" stroke="oklch(0.75 0.13 240)" strokeWidth="0.7" />
    </svg>
  ),
  gd: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="oklch(0.7 0.18 25 / 0.15)" stroke="oklch(0.7 0.18 25)" strokeWidth="0.9" />
      <text x="6" y="8" fontSize="4.5" fill="oklch(0.7 0.18 25)" textAnchor="middle" fontFamily="monospace" fontWeight="700">gd</text>
    </svg>
  ),
  config: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6">
      <circle cx="6" cy="6" r="1.5" />
      <circle cx="6" cy="6" r="3.5" strokeDasharray="2 1.5" />
    </svg>
  ),
  gif: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="oklch(0.78 0.16 var(--accent-h) / 0.15)" stroke="oklch(0.78 0.16 var(--accent-h))" strokeWidth="0.9" />
      <text x="6" y="8" fontSize="4.5" fill="oklch(0.78 0.16 var(--accent-h))" textAnchor="middle" fontFamily="monospace" fontWeight="700">GIF</text>
    </svg>
  ),
  zoomIn: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="3.5" />
      <line x1="9" y1="9" x2="12" y2="12" />
      <line x1="4.5" y1="6" x2="7.5" y2="6" />
      <line x1="6" y1="4.5" x2="6" y2="7.5" />
    </svg>
  ),
  zoomOut: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="3.5" />
      <line x1="9" y1="9" x2="12" y2="12" />
      <line x1="4.5" y1="6" x2="7.5" y2="6" />
    </svg>
  ),
  grid: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="2" y="2" width="3" height="3" />
      <rect x="7" y="2" width="3" height="3" />
      <rect x="2" y="7" width="3" height="3" />
      <rect x="7" y="7" width="3" height="3" />
    </svg>
  ),
  scissors: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="10" r="2" />
      <circle cx="10" cy="10" r="2" />
      <line x1="5.5" y1="8.5" x2="11.5" y2="2.5" />
      <line x1="8.5" y1="8.5" x2="2.5" y2="2.5" />
    </svg>
  ),
  refresh: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 7 a5 5 0 1 1 -1.5-3.5" />
      <path d="M12 2 V4 H10" />
    </svg>
  ),
  plus: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="6" y1="3" x2="6" y2="9" />
      <line x1="3" y1="6" x2="9" y2="6" />
    </svg>
  ),
  image: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="3" width="10" height="8" rx="1" />
      <circle cx="5" cy="6" r="1" />
      <path d="M2 10 L5.5 7 L8 9 L12 6" />
    </svg>
  ),
  bash: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4 L6 7 L3 10" />
      <line x1="7" y1="10" x2="11" y2="10" />
    </svg>
  ),
  view: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7 C 4 3.5 10 3.5 12 7 C 10 10.5 4 10.5 2 7 Z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  ),
  edit: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2 L12 5 L5 12 L2 12 L2 9 Z" />
    </svg>
  ),
  search: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="3.5" />
      <line x1="9" y1="9" x2="12" y2="12" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  ),
  spark: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M7 1 L8.5 5.5 L13 7 L8.5 8.5 L7 13 L5.5 8.5 L1 7 L5.5 5.5 Z" fill="currentColor" />
    </svg>
  ),
  branch: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="3" r="1.4" />
      <circle cx="4" cy="11" r="1.4" />
      <circle cx="10" cy="6" r="1.4" />
      <path d="M4 4.4 V 9.6" />
      <path d="M4 7 C 4 6 6 6 8.6 6" />
    </svg>
  ),
  retry: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7 a5 5 0 1 0 1.5-3.5 L2 5" />
      <path d="M2 2 V5 H5" />
    </svg>
  ),
  paperclip: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 6 L6.5 10.5 a2.5 2.5 0 0 1 -3.5 -3.5 L8.5 1.5 a1.7 1.7 0 0 1 2.4 2.4 L5.5 9.5" />
    </svg>
  ),
  warn: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 2 L13 12 L1 12 Z" />
      <line x1="7" y1="6" x2="7" y2="9" />
      <circle cx="7" cy="10.5" r="0.4" fill="currentColor" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5 L5.5 10.5 L11.5 3.5" />
    </svg>
  ),
  more: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="3" cy="7" r="1" />
      <circle cx="7" cy="7" r="1" />
      <circle cx="11" cy="7" r="1" />
    </svg>
  ),
  sun: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="7" cy="7" r="2.4" />
      <line x1="7" y1="1.5" x2="7" y2="3" />
      <line x1="7" y1="11" x2="7" y2="12.5" />
      <line x1="1.5" y1="7" x2="3" y2="7" />
      <line x1="11" y1="7" x2="12.5" y2="7" />
      <line x1="3" y1="3" x2="4" y2="4" />
      <line x1="10" y1="10" x2="11" y2="11" />
      <line x1="11" y1="3" x2="10" y2="4" />
      <line x1="4" y1="10" x2="3" y2="11" />
    </svg>
  ),
  moon: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M11.5 8.5 A4.5 4.5 0 1 1 5.5 2.5 a3.5 3.5 0 0 0 6 6 Z" />
    </svg>
  ),
};
