import type { Database as GeneratedDatabase } from "./database";

type PublicSchema = GeneratedDatabase["public"];
type GeneratedFunctions = PublicSchema["Functions"];

type WithArgs<
  FunctionName extends keyof GeneratedFunctions,
  Args,
> = Omit<GeneratedFunctions[FunctionName], "Args"> & { Args: Args };

/**
 * Postgres allows nullable function arguments, but generated Supabase function
 * metadata does not encode that nullability. Keep the generated file pristine
 * and narrow nullable RPC arguments at the application boundary.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<PublicSchema, "Functions"> & {
    Functions: Omit<
      GeneratedFunctions,
      | "append_itinerary_item"
      | "capture_public_lead"
      | "create_quote_draft"
      | "settle_ai_job"
      | "transition_deal_stage"
    > & {
      append_itinerary_item: WithArgs<
        "append_itinerary_item",
        Omit<
          GeneratedFunctions["append_itinerary_item"]["Args"],
          "target_location_name" | "target_notes"
        > & {
          target_location_name: string | null;
          target_notes: string | null;
        }
      >;
      create_quote_draft: WithArgs<
        "create_quote_draft",
        Omit<
          GeneratedFunctions["create_quote_draft"]["Args"],
          "quote_valid_until"
        > & {
          quote_valid_until: string | null;
        }
      >;
      capture_public_lead: WithArgs<
        "capture_public_lead",
        Omit<
          GeneratedFunctions["capture_public_lead"]["Args"],
          | "target_budget_amount"
          | "target_destination"
          | "target_email"
          | "target_landing_path"
          | "target_notes"
          | "target_phone"
          | "target_referrer_host"
          | "target_utm_campaign"
          | "target_utm_medium"
          | "target_utm_source"
        > & {
          target_budget_amount: number | null;
          target_destination: string | null;
          target_email: string | null;
          target_landing_path: string | null;
          target_notes: string | null;
          target_phone: string | null;
          target_referrer_host: string | null;
          target_utm_campaign: string | null;
          target_utm_medium: string | null;
          target_utm_source: string | null;
        }
      >;
      settle_ai_job: WithArgs<
        "settle_ai_job",
        Omit<
          GeneratedFunctions["settle_ai_job"]["Args"],
          "target_error_code"
        > & {
          target_error_code: string | null;
        }
      >;
      transition_deal_stage: WithArgs<
        "transition_deal_stage",
        Omit<
          GeneratedFunctions["transition_deal_stage"]["Args"],
          "target_lost_reason"
        > & {
          target_lost_reason: string | null;
        }
      >;
    };
  };
};
