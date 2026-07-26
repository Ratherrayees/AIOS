import Link from "next/link";

import { Button } from "../../components/ui/button";
import { FormFeedback, FormField } from "../../components/ui/form-field";
import { signUp } from "./actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <Link href="/" className="auth-brand">
          <span>A</span> AIOS
        </Link>
        <p className="eyebrow">CREATE YOUR WORKSPACE</p>
        <h1>Start with certainty.</h1>
        <p>
          {next
            ? "Verify your email, then continue into the workspace that invited you."
            : "Your first organization is created after you verify your email."}
        </p>
        {error && (
          <FormFeedback tone="error">
            Please use a valid name, email address, and a password with at least
            12 characters.
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
              placeholder="At least 12 characters"
            />
          </FormField>
          <Button type="submit" fullWidth>
            Create secure account <span>→</span>
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
