import Link from "next/link";

import { Button } from "../../components/ui/button";
import { FormFeedback, FormField } from "../../components/ui/form-field";
import { signUp } from "./actions";

const errors: Record<string, string> = {
  configuration:
    "Account creation is temporarily unavailable because secure authentication delivery is not configured.",
  "confirmation-disabled":
    "Account creation is paused because email confirmation is not enforced by the authentication provider.",
  "verification-session":
    "Your verification session expired. Enter your details to request a new code.",
  signup:
    "We could not create that account. It may already exist, or signup may be temporarily unavailable.",
  validation:
    "Please use a valid name, email address, and a password that meets every requirement below.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const platformInvitation = next?.startsWith("/auth/platform-invite");
  const alert = error
    ? (errors[error] ?? "Account creation could not be completed.")
    : null;
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <Link href="/" className="auth-brand">
          <span>A</span> AIOS
        </Link>
        <p className="eyebrow">
          {platformInvitation ? "CREATE PLATFORM IDENTITY" : "CREATE YOUR WORKSPACE"}
        </p>
        <h1>Create your AIOS account.</h1>
        <p>
          {platformInvitation
            ? "We’ll verify the invited email with a six-digit identity code. Platform access still requires an authenticator and does not create an agency."
            : next
            ? "We’ll verify your work email with a six-digit code, then return you to the invitation."
            : "We’ll verify your work email with a six-digit code before creating your first organization."}
        </p>
        {alert && (
          <FormFeedback tone="error">
            {alert}
          </FormFeedback>
        )}
        <form action={signUp}>
          {next && <input name="next" type="hidden" value={next} />}
          <FormField label="Your name">
            <input
              name="fullName"
              autoComplete="name"
              required
              placeholder="Rayees Amin"
            />
          </FormField>
          <FormField label="Work email">
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@company.com"
            />
          </FormField>
          <FormField label="Password">
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,200}"
              title="Use at least 12 characters with uppercase, lowercase, a number, and a symbol."
              placeholder="Create a strong password"
            />
          </FormField>
          <p className="auth-field-hint">
            At least 12 characters with uppercase, lowercase, a number, and a
            symbol.
          </p>
          <Button type="submit" fullWidth>
            Continue to email verification <span>→</span>
          </Button>
        </form>
        <div className="auth-links">
          <p>
            Already have access?{" "}
            <Link
              href={
                next
                  ? `/sign-in?next=${encodeURIComponent(next)}`
                  : "/sign-in"
              }
            >
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
