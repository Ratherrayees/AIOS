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
      | "create_quote_catalog_product"
      | "create_quote_draft"
      | "publish_quote_catalog_rate"
      | "settle_ai_job"
      | "set_organization_subscription_service"
      | "set_platform_access_service"
      | "transition_deal_stage"
    > & {
      append_itinerary_item: WithArgs<
        "append_itinerary_item",
        Omit<
          GeneratedFunctions["append_itinerary_item"]["Args"],
          | "target_ends_at_local"
          | "target_location_name"
          | "target_notes"
          | "target_starts_at_local"
          | "target_time_zone"
        > & {
          target_ends_at_local: string | null;
          target_location_name: string | null;
          target_notes: string | null;
          target_starts_at_local: string | null;
          target_time_zone: string | null;
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
      create_quote_catalog_product: WithArgs<
        "create_quote_catalog_product",
        Omit<
          GeneratedFunctions["create_quote_catalog_product"]["Args"],
          "target_supplier_id" | "target_valid_until"
        > & {
          target_supplier_id: string | null;
          target_valid_until: string | null;
        }
      >;
      publish_quote_catalog_rate: WithArgs<
        "publish_quote_catalog_rate",
        Omit<
          GeneratedFunctions["publish_quote_catalog_rate"]["Args"],
          "target_valid_until"
        > & {
          target_valid_until: string | null;
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
      set_organization_subscription_service: WithArgs<
        "set_organization_subscription_service",
        Omit<
          GeneratedFunctions["set_organization_subscription_service"]["Args"],
          | "expected_version"
          | "target_grace_ends_at"
          | "target_period_end"
          | "target_period_start"
          | "target_trial_ends_at"
        > & {
          expected_version: number | null;
          target_grace_ends_at: string | null;
          target_period_end: string | null;
          target_period_start: string | null;
          target_trial_ends_at: string | null;
        }
      >;
      set_platform_access_service: WithArgs<
        "set_platform_access_service",
        Omit<
          GeneratedFunctions["set_platform_access_service"]["Args"],
          "expected_version"
        > & {
          expected_version: number | null;
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
