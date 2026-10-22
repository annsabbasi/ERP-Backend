import type { ButtonHTMLAttributes } from 'react';
import { color, radii, space } from './tokens';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ style, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      style={{
        background: color('primary'),
        color: color('onPrimary'),
        border: 'none',
        borderRadius: radii.md,
        padding: `${space(2)} ${space(4)}`,
        font: 'inherit',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
        ...style,
      }}
      {...props}
    />
  );
}
