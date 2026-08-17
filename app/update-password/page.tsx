import { FormFeedback, FormField } from "../../components/ui/form-field";
import { Button } from "../../components/ui/button";
import { safeInternalPath } from "../../lib/auth/safe-next";
import { updatePassword } from "./actions";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; required?: string; next?: string }>;
}) {
  const { error, required, next } = await searchParams;
  const nextPath = safeInternalPath(next);
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <p className="eyebrow">{required === "1" ? "SECURITY REQUIREMENT" : "ACCOUNT RECOVERY"}</p>
        <h1>Choose a new password.</h1>
        <p>
          {required === "1"
            ? "An administrator required a password reset. Choose a password you do not use elsewhere."
            : "This recovery session is temporary. Choose a password you do not use elsewhere."}
        </p>
        {error && (
          <FormFeedback tone="error">
            {error === "validation"
              ? "Use at least 12 characters with uppercase, lowercase, a number, and a symbol."
              : "Recovery could not be completed. Request a fresh link and try again."}
          </FormFeedback>
        )}
        <form action={updatePassword}>
          <input type="hidden" name="required" value={required === "1" ? "1" : "0"} />
          <input type="hidden" name="next" value={nextPath} />
          <FormField label="New password">
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,200}"
              title="Use at least 12 characters with uppercase, lowercase, a number, and a symbol."
              required
              placeholder="Create a strong password"
            />
          </FormField>
          <p className="auth-field-hint">
            At least 12 characters with uppercase, lowercase, a number, and a
            symbol.
          </p>
          <Button type="submit" fullWidth>
            Update password
          </Button>
        </form>
      </section>
    </main>
  );
}
