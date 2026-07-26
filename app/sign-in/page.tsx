import Link from "next/link";
import { signIn } from "./actions";
import { Button } from "../../components/ui/button";
import { FormFeedback, FormField } from "../../components/ui/form-field";

const errors: Record<string, string> = {
  callback: "We could not complete that sign-in link. Please try again.",
  configuration:
    "Sign-in is not configured yet. Add deployment credentials when you are ready to connect Supabase.",
  credentials: "Those sign-in details were not accepted.",
  validation: "Enter a valid email address and password.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next } = await searchParams;
  const alert = error
    ? (errors[error] ?? "Sign-in could not be completed.")
    : message === "password-updated"
      ? "Your password has been updated. You can now sign in."
      : message === "check-email"
        ? "Check your email to continue."
        : null;

  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <Link href="/" className="auth-brand">
          <span>A</span>
          AIOS
        </Link>
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1>Welcome back.</h1>
        <p>
          Sign in to Altitude Travel&apos;s private operating workspace.
        </p>
        {alert && (
          <FormFeedback tone={error ? "error" : "success"}>
            {alert}
          </FormFeedback>
        )}
        <form action={signIn}>
          {next && <input name="next" type="hidden" value={next} />}
          <FormField label="Email address">
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
              autoComplete="current-password"
              required
              minLength={8}
              placeholder="Your password"
            />
          </FormField>
          <Button type="submit" fullWidth>
            Sign in <span>→</span>
          </Button>
        </form>
        <div className="auth-links">
          <p><Link href="/forgot-password">Forgot your password?</Link></p>
          <p>
            New to AIOS?{" "}
            <Link
              href={
                next
                  ? `/sign-up?next=${encodeURIComponent(next)}`
                  : "/sign-up"
              }
            >
              Create your account
            </Link>
          </p>
          <p className="auth-security">Protected by tenant-level access controls and audit trails.</p>
        </div>
      </section>
    </main>
  );
}
