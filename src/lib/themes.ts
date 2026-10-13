import type { Theme } from '@/store/ui-store';

/**
 * The themes on offer, in the order they are shown. Shared by the Settings
 * panel and the nav rail switcher so the two cannot drift apart.
 *
 * `swatch` is a literal CSS background rather than a token: it has to depict a
 * theme that is NOT currently applied, so it cannot read from the live
 * variables. The values mirror each theme's own --surface in global.css.
 */
export interface ThemeOption {
  value: Theme;
  label: string;
  swatch: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', swatch: '#ffffff' },
  { value: 'dark', label: 'Dark', swatch: '#09090b' },
  { value: 'system', label: 'System', swatch: 'linear-gradient(90deg, #ffffff 0 50%, #09090b 50% 100%)' },
  { value: 'purple', label: 'Purple', swatch: 'linear-gradient(150deg, #2a1150 0%, #180d30 55%, #0a0417 100%)' },
];

export function themeOption(value: Theme): ThemeOption {
  return THEME_OPTIONS.find((o) => o.value === value) ?? THEME_OPTIONS[0];
}
