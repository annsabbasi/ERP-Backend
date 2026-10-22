// Design tokens (§12.6). Components read them as CSS variables, so the
// light and dark values switch without re-rendering.

type ColorRoles = {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
  success: string;
  danger: string;
};

export const colors: { light: ColorRoles; dark: ColorRoles } = {
  light: {
    background: '#ffffff',
    surface: '#f6f7f9',
    text: '#111827',
    textMuted: '#4b5563',
    border: '#d1d5db',
    primary: '#1d4ed8',
    onPrimary: '#ffffff',
    success: '#15803d',
    danger: '#b91c1c',
  },
  dark: {
    background: '#0b0f17',
    surface: '#151b26',
    text: '#f3f4f6',
    textMuted: '#9ca3af',
    border: '#374151',
    primary: '#60a5fa',
    onPrimary: '#0b0f17',
    success: '#4ade80',
    danger: '#f87171',
  },
};

/** 4 px grid: space(2) === '8px'. */
export const SPACING_UNIT_PX = 4;
export const space = (steps: number): string => `${steps * SPACING_UNIT_PX}px`;

export const radii = { sm: '4px', md: '8px', lg: '12px' } as const;

const cssName = (role: string) =>
  `--erp-color-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const declarations = (roles: ColorRoles) =>
  Object.entries(roles)
    .map(([role, value]) => `${cssName(role)}: ${value};`)
    .join(' ');

/** CSS that defines every token as a variable, for light and dark mode. */
export const tokensCss = [
  `:root { ${declarations(colors.light)} --erp-radius-sm: ${radii.sm}; --erp-radius-md: ${radii.md}; --erp-radius-lg: ${radii.lg}; --erp-space: ${SPACING_UNIT_PX}px; }`,
  `@media (prefers-color-scheme: dark) { :root { ${declarations(colors.dark)} } }`,
].join('\n');

/** Adds the token variables to the document once. */
export function injectTokens(doc: Document = document): void {
  if (doc.getElementById('erp-tokens')) return;
  const style = doc.createElement('style');
  style.id = 'erp-tokens';
  style.textContent = tokensCss;
  doc.head.appendChild(style);
}

/** `var(--erp-color-…)` for a colour role. */
export const color = (role: keyof ColorRoles): string => `var(${cssName(role)})`;
