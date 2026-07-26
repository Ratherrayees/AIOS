import Link from "next/link";
import { Button } from "../../components/ui/button";
import { FormFeedback, FormField } from "../../components/ui/form-field";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <Link href="/sign-in" className="auth-brand">
          <span>A</span> AIOS
        </Link>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Reset your password.</h1>
        <p>
          Enter your work email and we&apos;ll send recovery instructions if an
          account is available.
        </p>
        {sent ? (
          <FormFeedback tone="success">
            If that email has an AIOS account, recovery instructions are on
            their way.
          </FormFeedback>
        ) : (
          <form action={requestPasswordReset}>
            <FormField label="Work email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@company.com"
              />
            </FormField>
            <Button type="submit" fullWidth>
              Send recovery instructions
            </Button>
          </form>
        )}
        <Link href="/sign-in" className="auth-secondary">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
