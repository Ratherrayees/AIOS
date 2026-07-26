import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "small" | "medium";
  fullWidth?: boolean;
  children: ReactNode;
};

/** Shared accessible button styling without hiding native button semantics. */
export function Button({
  variant = "primary",
  size = "medium",
  fullWidth = false,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        "ui-button",
        `ui-button-${variant}`,
        `ui-button-${size}`,
        fullWidth ? "ui-button-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
