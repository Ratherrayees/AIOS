import { FormFeedback, FormField } from "../../components/ui/form-field";
import { Button } from "../../components/ui/button";
import { updatePassword } from "./actions";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Choose a new password.</h1>
        <p>
          This recovery session is temporary. Choose a password you do not use
          elsewhere.
        </p>
        {error && (
          <FormFeedback tone="error">
            {error === "validation"
              ? "Use a new password with at least 12 characters."
              : "Recovery could not be completed. Request a fresh link and try again."}
          </FormFeedback>
        )}
        <form action={updatePassword}>
          <FormField label="New password">
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              placeholder="At least 12 characters"
            />
          </FormField>
          <Button type="submit" fullWidth>
            Update password
          </Button>
        </form>
      </section>
    </main>
  );
}
