import { Button } from "../../components/ui/button";
import { FormFeedback, FormField } from "../../components/ui/form-field";
import { createWorkspace } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-page" id="main-content" tabIndex={-1}>
      <section className="auth-card">
        <p className="eyebrow">WELCOME TO AIOS</p>
        <h1>Name your travel workspace.</h1>
        <p>
          You will be the owner and can invite your team once the workspace is
          created.
        </p>
        {error && (
          <FormFeedback tone="error">
            Enter a workspace name with at least two characters.
          </FormFeedback>
        )}
        <form action={createWorkspace}>
          <FormField label="Workspace name">
            <input name="name" required placeholder="Your agency name" />
          </FormField>
          <Button type="submit" fullWidth>
            Create workspace <span>→</span>
          </Button>
        </form>
      </section>
    </main>
  );
}
