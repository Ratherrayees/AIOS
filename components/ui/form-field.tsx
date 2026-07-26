import type { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  children: ReactNode;
};

/** A deliberately small, accessible form primitive for server and client pages. */
export function FormField({ label, children }: FormFieldProps) {
  return (
    <label className="ui-form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

type FormFeedbackProps = {
  tone: "error" | "success";
  children: ReactNode;
};

export function FormFeedback({ tone, children }: FormFeedbackProps) {
  return (
    <p
      className={`ui-form-feedback ui-form-feedback-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
