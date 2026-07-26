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
 * and narrow the three nullable RPC arguments at the application boundary.
 */
export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<PublicSchema, "Functions"> & {
    Functions: Omit<
      GeneratedFunctions,
      "append_itinerary_item" | "create_quote_draft" | "settle_ai_job"
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
      settle_ai_job: WithArgs<
        "settle_ai_job",
        Omit<
          GeneratedFunctions["settle_ai_job"]["Args"],
          "target_error_code"
        > & {
          target_error_code: string | null;
        }
      >;
    };
  };
};
