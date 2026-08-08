export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activity_events: {
        Row: {
          activity_type: string
          actor_id: string | null
          body: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          metadata: Json
          organization_id: string
          trip_id: string | null
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          trip_id?: string | null
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          body?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_company_same_organization_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "activity_events_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "activity_events_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_autonomy_policies: {
        Row: {
          action: string
          approval_roles: Database["public"]["Enums"]["app_role"][]
          created_at: string
          escalation_after_minutes: number
          id: string
          is_enabled: boolean
          mode: Database["public"]["Enums"]["ai_autonomy_mode"]
          organization_id: string
          updated_at: string
        }
        Insert: {
          action: string
          approval_roles?: Database["public"]["Enums"]["app_role"][]
          created_at?: string
          escalation_after_minutes?: number
          id?: string
          is_enabled?: boolean
          mode?: Database["public"]["Enums"]["ai_autonomy_mode"]
          organization_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          approval_roles?: Database["public"]["Enums"]["app_role"][]
          created_at?: string
          escalation_after_minutes?: number
          id?: string
          is_enabled?: boolean
          mode?: Database["public"]["Enums"]["ai_autonomy_mode"]
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_autonomy_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_budget_policies: {
        Row: {
          allowed_model_providers: string[]
          created_at: string
          daily_model_run_limit: number
          fallback_model_provider: string | null
          id: string
          model_execution_enabled: boolean
          organization_id: string
          selected_model_provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_model_providers?: string[]
          created_at?: string
          daily_model_run_limit?: number
          fallback_model_provider?: string | null
          id?: string
          model_execution_enabled?: boolean
          organization_id: string
          selected_model_provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_model_providers?: string[]
          created_at?: string
          daily_model_run_limit?: number
          fallback_model_provider?: string | null
          id?: string
          model_execution_enabled?: boolean
          organization_id?: string
          selected_model_provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_budget_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_budget_policies_updater_same_organization_fkey"
            columns: ["organization_id", "updated_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      ai_field_reviews: {
        Row: {
          ai_run_id: string
          created_at: string
          decision: Database["public"]["Enums"]["ai_field_review_decision"]
          entity_id: string
          entity_type: string
          field_name: string
          id: string
          organization_id: string
          proposed_value: Json
          reviewed_at: string
          reviewed_by: string
        }
        Insert: {
          ai_run_id: string
          created_at?: string
          decision: Database["public"]["Enums"]["ai_field_review_decision"]
          entity_id: string
          entity_type: string
          field_name: string
          id?: string
          organization_id: string
          proposed_value: Json
          reviewed_at?: string
          reviewed_by: string
        }
        Update: {
          ai_run_id?: string
          created_at?: string
          decision?: Database["public"]["Enums"]["ai_field_review_decision"]
          entity_id?: string
          entity_type?: string
          field_name?: string
          id?: string
          organization_id?: string
          proposed_value?: Json
          reviewed_at?: string
          reviewed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_field_reviews_ai_run_same_organization_fkey"
            columns: ["organization_id", "ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_field_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_field_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_jobs: {
        Row: {
          ai_run_id: string
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          job_type: Database["public"]["Enums"]["ai_job_type"]
          last_error_code: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          organization_id: string
          payload: Json
          status: Database["public"]["Enums"]["ai_job_status"]
          updated_at: string
        }
        Insert: {
          ai_run_id: string
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          job_type: Database["public"]["Enums"]["ai_job_type"]
          last_error_code?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organization_id: string
          payload?: Json
          status?: Database["public"]["Enums"]["ai_job_status"]
          updated_at?: string
        }
        Update: {
          ai_run_id?: string
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          job_type?: Database["public"]["Enums"]["ai_job_type"]
          last_error_code?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          organization_id?: string
          payload?: Json
          status?: Database["public"]["Enums"]["ai_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_run_same_organization_fkey"
            columns: ["organization_id", "ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      ai_model_prices: {
        Row: {
          approved_by: string | null
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          input_price_per_million: number
          model: string
          organization_id: string
          output_price_per_million: number
          provider: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          currency: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          input_price_per_million: number
          model: string
          organization_id: string
          output_price_per_million: number
          provider: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          input_price_per_million?: number
          model?: string
          organization_id?: string
          output_price_per_million?: number
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_model_prices_approver_same_organization_fkey"
            columns: ["organization_id", "approved_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "ai_model_prices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_runs: {
        Row: {
          agent_type: string
          agent_version: string
          approval_request_id: string | null
          citations: Json
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          estimated_cost: number | null
          estimated_cost_currency: string | null
          id: string
          initiated_by: string | null
          input_reference: Json
          input_tokens: number | null
          model_price_id: string | null
          organization_id: string
          output_tokens: number | null
          result: Json | null
          status: Database["public"]["Enums"]["ai_run_status"]
        }
        Insert: {
          agent_type: string
          agent_version: string
          approval_request_id?: string | null
          citations?: Json
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost?: number | null
          estimated_cost_currency?: string | null
          id?: string
          initiated_by?: string | null
          input_reference?: Json
          input_tokens?: number | null
          model_price_id?: string | null
          organization_id: string
          output_tokens?: number | null
          result?: Json | null
          status?: Database["public"]["Enums"]["ai_run_status"]
        }
        Update: {
          agent_type?: string
          agent_version?: string
          approval_request_id?: string | null
          citations?: Json
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          estimated_cost?: number | null
          estimated_cost_currency?: string | null
          id?: string
          initiated_by?: string | null
          input_reference?: Json
          input_tokens?: number | null
          model_price_id?: string | null
          organization_id?: string
          output_tokens?: number | null
          result?: Json | null
          status?: Database["public"]["Enums"]["ai_run_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_approval_request_same_organization_fkey"
            columns: ["organization_id", "approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_runs_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_model_price_same_organization_fkey"
            columns: ["organization_id", "model_price_id"]
            isOneToOne: false
            referencedRelation: "ai_model_prices"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_tool_calls: {
        Row: {
          ai_run_id: string
          arguments: Json
          created_at: string
          decision: string
          id: string
          organization_id: string
          requested_action: string
          result: Json | null
          tool_name: string
        }
        Insert: {
          ai_run_id: string
          arguments?: Json
          created_at?: string
          decision: string
          id?: string
          organization_id: string
          requested_action: string
          result?: Json | null
          tool_name: string
        }
        Update: {
          ai_run_id?: string
          arguments?: Json
          created_at?: string
          decision?: string
          id?: string
          organization_id?: string
          requested_action?: string
          result?: Json | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tool_calls_ai_run_same_organization_fkey"
            columns: ["organization_id", "ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "ai_tool_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_report_deliveries: {
        Row: {
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          organization_id: string
          report_csv: string | null
          report_filename: string | null
          report_row_count: number | null
          report_sha256: string | null
          schedule_snapshot: Json
          scheduled_for: string
          started_at: string
          status: string
          trigger_type: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          report_csv?: string | null
          report_filename?: string | null
          report_row_count?: number | null
          report_sha256?: string | null
          schedule_snapshot: Json
          scheduled_for: string
          started_at?: string
          status?: string
          trigger_type: string
          worker_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          report_csv?: string | null
          report_filename?: string | null
          report_row_count?: number | null
          report_sha256?: string | null
          schedule_snapshot?: Json
          scheduled_for?: string
          started_at?: string
          status?: string
          trigger_type?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_report_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_report_schedules: {
        Row: {
          cadence: string
          created_at: string
          forecast_horizon_days: number
          is_enabled: boolean
          last_delivery_at: string | null
          last_delivery_status: string | null
          next_run_at: string
          organization_id: string
          period_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cadence?: string
          created_at?: string
          forecast_horizon_days?: number
          is_enabled?: boolean
          last_delivery_at?: string | null
          last_delivery_status?: string | null
          next_run_at?: string
          organization_id: string
          period_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cadence?: string
          created_at?: string
          forecast_horizon_days?: number
          is_enabled?: boolean
          last_delivery_at?: string | null
          last_delivery_status?: string | null
          next_run_at?: string
          organization_id?: string
          period_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_report_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_report_schedules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_targets: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          period_end: string
          period_start: string
          target_amount: number
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency: string
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          period_end: string
          period_start: string
          target_amount: number
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          target_amount?: number
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_targets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          action: string
          approver_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          expires_at: string | null
          id: string
          organization_id: string
          payload: Json
          rationale: string | null
          requester_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          action: string
          approver_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          expires_at?: string | null
          id?: string
          organization_id: string
          payload?: Json
          rationale?: string | null
          requester_id: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          action?: string
          approver_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          payload?: Json
          rationale?: string | null
          requester_id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_type: string
          confirmation_reference: string | null
          confirmed_at: string | null
          cost_amount: number | null
          created_at: string
          currency: string
          details: Json
          id: string
          organization_id: string
          service_end_at: string | null
          service_start_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          supplier_id: string | null
          title: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          booking_type: string
          confirmation_reference?: string | null
          confirmed_at?: string | null
          cost_amount?: number | null
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          organization_id: string
          service_end_at?: string | null
          service_start_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          supplier_id?: string | null
          title?: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          booking_type?: string
          confirmation_reference?: string | null
          confirmed_at?: string | null
          cost_amount?: number | null
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          organization_id?: string
          service_end_at?: string | null
          service_start_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          supplier_id?: string | null
          title?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_supplier_same_organization_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "bookings_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      companies: {
        Row: {
          archived_at: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string
          owner_id: string | null
          phone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id: string
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_owner_same_organization_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived_at: string | null
          communication_consent: Database["public"]["Enums"]["contact_consent_status"]
          company_id: string | null
          consent_recorded_at: string | null
          consent_source: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          organization_id: string
          owner_id: string | null
          phone: string | null
          preferred_channel: Database["public"]["Enums"]["contact_channel_preference"]
          preferred_locale: string | null
          time_zone: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          communication_consent?: Database["public"]["Enums"]["contact_consent_status"]
          company_id?: string | null
          consent_recorded_at?: string | null
          consent_source?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          organization_id: string
          owner_id?: string | null
          phone?: string | null
          preferred_channel?: Database["public"]["Enums"]["contact_channel_preference"]
          preferred_locale?: string | null
          time_zone?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          communication_consent?: Database["public"]["Enums"]["contact_consent_status"]
          company_id?: string | null
          consent_recorded_at?: string | null
          consent_source?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          organization_id?: string
          owner_id?: string | null
          phone?: string | null
          preferred_channel?: Database["public"]["Enums"]["contact_channel_preference"]
          preferred_locale?: string | null
          time_zone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_same_organization_fkey"
            columns: ["organization_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_same_organization_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          channel: Database["public"]["Enums"]["conversation_channel"]
          contact_id: string | null
          created_at: string
          deal_id: string | null
          external_id: string | null
          id: string
          last_message_at: string | null
          organization_id: string
          priority: string
          response_due_at: string | null
          sla_escalated_at: string | null
          sla_escalation_level: number
          status: Database["public"]["Enums"]["conversation_status"]
          subject: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          channel: Database["public"]["Enums"]["conversation_channel"]
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          external_id?: string | null
          id?: string
          last_message_at?: string | null
          organization_id: string
          priority?: string
          response_due_at?: string | null
          sla_escalated_at?: string | null
          sla_escalation_level?: number
          status?: Database["public"]["Enums"]["conversation_status"]
          subject?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel"]
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          external_id?: string | null
          id?: string
          last_message_at?: string | null
          organization_id?: string
          priority?: string
          response_due_at?: string | null
          sla_escalated_at?: string | null
          sla_escalation_level?: number
          status?: Database["public"]["Enums"]["conversation_status"]
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_same_organization_fkey"
            columns: ["organization_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "conversations_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_follow_up_sequence_runs: {
        Row: {
          created_at: string
          deal_id: string
          enrolled_by: string
          id: string
          organization_id: string
          sequence_id: string
          tasks_created: number
        }
        Insert: {
          created_at?: string
          deal_id: string
          enrolled_by: string
          id?: string
          organization_id: string
          sequence_id: string
          tasks_created: number
        }
        Update: {
          created_at?: string
          deal_id?: string
          enrolled_by?: string
          id?: string
          organization_id?: string
          sequence_id?: string
          tasks_created?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_follow_up_sequence_runs_enrolled_by_fkey"
            columns: ["enrolled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_follow_up_sequence_runs_organization_id_deal_id_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "deal_follow_up_sequence_runs_organization_id_enrolled_by_fkey"
            columns: ["organization_id", "enrolled_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "deal_follow_up_sequence_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_follow_up_sequence_runs_organization_id_sequence_id_fkey"
            columns: ["organization_id", "sequence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_sequences"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      deal_qualification_checks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          deal_id: string
          guidance: string | null
          id: string
          is_complete: boolean
          is_required: boolean
          label: string
          organization_id: string
          template_item_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deal_id: string
          guidance?: string | null
          id?: string
          is_complete?: boolean
          is_required?: boolean
          label: string
          organization_id: string
          template_item_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deal_id?: string
          guidance?: string | null
          id?: string
          is_complete?: boolean
          is_required?: boolean
          label?: string
          organization_id?: string
          template_item_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_qualification_checks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_qualification_checks_organization_id_completed_by_fkey"
            columns: ["organization_id", "completed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "deal_qualification_checks_organization_id_deal_id_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "deal_qualification_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_qualification_checks_organization_id_template_item_id_fkey"
            columns: ["organization_id", "template_item_id"]
            isOneToOne: false
            referencedRelation: "qualification_checklist_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      deal_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          deal_id: string
          duration_seconds: number | null
          from_stage: Database["public"]["Enums"]["deal_stage"] | null
          id: string
          organization_id: string
          reason: string | null
          to_stage: Database["public"]["Enums"]["deal_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          deal_id: string
          duration_seconds?: number | null
          from_stage?: Database["public"]["Enums"]["deal_stage"] | null
          id?: string
          organization_id: string
          reason?: string | null
          to_stage: Database["public"]["Enums"]["deal_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          deal_id?: string
          duration_seconds?: number | null
          from_stage?: Database["public"]["Enums"]["deal_stage"] | null
          id?: string
          organization_id?: string
          reason?: string | null
          to_stage?: Database["public"]["Enums"]["deal_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "deal_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_organization_id_deal_id_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "deal_stage_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          archived_at: string | null
          contact_id: string | null
          created_at: string
          currency: string
          destination: string | null
          expected_close_at: string | null
          first_responded_at: string | null
          first_response_due_at: string | null
          follow_up_due_at: string | null
          id: string
          last_activity_at: string | null
          lost_at: string | null
          lost_reason: string | null
          next_step: string | null
          notes: string | null
          organization_id: string
          owner_id: string | null
          probability: number
          qualified_at: string | null
          sla_escalated_at: string | null
          sla_escalation_level: number
          source: string | null
          source_campaign: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at: string
          title: string
          travel_end: string | null
          travel_start: string | null
          traveller_count: number | null
          updated_at: string
          value_amount: number | null
          won_at: string | null
        }
        Insert: {
          archived_at?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          destination?: string | null
          expected_close_at?: string | null
          first_responded_at?: string | null
          first_response_due_at?: string | null
          follow_up_due_at?: string | null
          id?: string
          last_activity_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          next_step?: string | null
          notes?: string | null
          organization_id: string
          owner_id?: string | null
          probability?: number
          qualified_at?: string | null
          sla_escalated_at?: string | null
          sla_escalation_level?: number
          source?: string | null
          source_campaign?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at?: string
          title: string
          travel_end?: string | null
          travel_start?: string | null
          traveller_count?: number | null
          updated_at?: string
          value_amount?: number | null
          won_at?: string | null
        }
        Update: {
          archived_at?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          destination?: string | null
          expected_close_at?: string | null
          first_responded_at?: string | null
          first_response_due_at?: string | null
          follow_up_due_at?: string | null
          id?: string
          last_activity_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          next_step?: string | null
          notes?: string | null
          organization_id?: string
          owner_id?: string | null
          probability?: number
          qualified_at?: string | null
          sla_escalated_at?: string | null
          sla_escalation_level?: number
          source?: string | null
          source_campaign?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at?: string
          title?: string
          travel_end?: string | null
          travel_start?: string | null
          traveller_count?: number | null
          updated_at?: string
          value_amount?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_same_organization_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      documents: {
        Row: {
          byte_size: number
          contact_id: string | null
          created_at: string
          document_kind: string
          expires_at: string | null
          file_name: string
          id: string
          mime_type: string
          organization_id: string
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          storage_path: string
          trip_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          byte_size: number
          contact_id?: string | null
          created_at?: string
          document_kind?: string
          expires_at?: string | null
          file_name: string
          id?: string
          mime_type: string
          organization_id: string
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          storage_path: string
          trip_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          byte_size?: number
          contact_id?: string | null
          created_at?: string
          document_kind?: string
          expires_at?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          organization_id?: string
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          storage_path?: string
          trip_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_webhook_events: {
        Row: {
          event_created_at: string
          event_type: string
          failure_reason: string | null
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          provider_event_id: string
          received_at: string
        }
        Insert: {
          event_created_at: string
          event_type: string
          failure_reason?: string | null
          id?: string
          payload: Json
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          received_at?: string
        }
        Update: {
          event_created_at?: string
          event_type?: string
          failure_reason?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          received_at?: string
        }
        Relationships: []
      }
      follow_up_sequence_steps: {
        Row: {
          created_at: string
          delay_days: number
          id: string
          organization_id: string
          position: number
          sequence_id: string
          title: string
        }
        Insert: {
          created_at?: string
          delay_days: number
          id?: string
          organization_id: string
          position: number
          sequence_id: string
          title: string
        }
        Update: {
          created_at?: string
          delay_days?: number
          id?: string
          organization_id?: string
          position?: number
          sequence_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequence_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequence_steps_organization_id_sequence_id_fkey"
            columns: ["organization_id", "sequence_id"]
            isOneToOne: false
            referencedRelation: "follow_up_sequences"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      follow_up_sequences: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_sequences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_sequences_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "follow_up_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_documents: {
        Row: {
          byte_size: number
          compliance_status: string
          content_sha256: string
          file_name: string
          generated_at: string
          generated_by: string
          id: string
          invoice_issuance_id: string
          invoice_number: string
          mime_type: string
          organization_id: string
          renderer_version: string
          source_issuance_sha256: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          byte_size: number
          compliance_status?: string
          content_sha256: string
          file_name: string
          generated_at?: string
          generated_by: string
          id?: string
          invoice_issuance_id: string
          invoice_number: string
          mime_type?: string
          organization_id: string
          renderer_version: string
          source_issuance_sha256: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          byte_size?: number
          compliance_status?: string
          content_sha256?: string
          file_name?: string
          generated_at?: string
          generated_by?: string
          id?: string
          invoice_issuance_id?: string
          invoice_number?: string
          mime_type?: string
          organization_id?: string
          renderer_version?: string
          source_issuance_sha256?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_documents_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_documents_issuance_same_organization_fkey"
            columns: ["organization_id", "invoice_issuance_id"]
            isOneToOne: false
            referencedRelation: "invoice_issuances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_drafts: {
        Row: {
          bill_to_name: string
          contact_id: string | null
          content_sha256: string
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string
          id: string
          line_count: number | null
          line_items: Json
          net_amount: number
          number_policy_updated_at: string
          number_preview: string
          organization_id: string
          payment_term_count: number | null
          payment_terms: Json
          quote_acceptance_id: string
          quote_id: string
          quote_payment_schedule_id: string
          quote_version_id: string
          revision: number
          status: string
          superseded_at: string | null
          superseded_by: string | null
          tax_amount: number
          total_amount: number
        }
        Insert: {
          bill_to_name: string
          contact_id?: string | null
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          currency: string
          deal_id: string
          id?: string
          line_count?: number | null
          line_items: Json
          net_amount: number
          number_policy_updated_at: string
          number_preview: string
          organization_id: string
          payment_term_count?: number | null
          payment_terms: Json
          quote_acceptance_id: string
          quote_id: string
          quote_payment_schedule_id: string
          quote_version_id: string
          revision: number
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          tax_amount: number
          total_amount: number
        }
        Update: {
          bill_to_name?: string
          contact_id?: string | null
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string
          id?: string
          line_count?: number | null
          line_items?: Json
          net_amount?: number
          number_policy_updated_at?: string
          number_preview?: string
          organization_id?: string
          payment_term_count?: number | null
          payment_terms?: Json
          quote_acceptance_id?: string
          quote_id?: string
          quote_payment_schedule_id?: string
          quote_version_id?: string
          revision?: number
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          tax_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_drafts_acceptance_exact_version_fkey"
            columns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "quote_acceptance_id",
            ]
            isOneToOne: false
            referencedRelation: "quote_acceptances"
            referencedColumns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "invoice_drafts_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_drafts_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_drafts_schedule_exact_version_fkey"
            columns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "quote_payment_schedule_id",
            ]
            isOneToOne: false
            referencedRelation: "quote_payment_schedules"
            referencedColumns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "invoice_drafts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_drafts_version_same_organization_fkey"
            columns: ["organization_id", "quote_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "quote_id", "id"]
          },
        ]
      }
      invoice_issuances: {
        Row: {
          approval_request_id: string
          approved_at: string
          approved_by: string
          bill_to_name: string
          currency: string
          deal_id: string
          draft_revision: number
          id: string
          invoice_draft_id: string
          invoice_number: string
          issuance_sha256: string
          issued_at: string
          issued_by: string
          issuer_jurisdiction_country_code: string
          issuer_legal_name: string
          issuer_profile_updated_at: string
          issuer_registered_address: string
          issuer_tax_registration_id: string | null
          line_count: number | null
          line_items: Json
          net_amount: number
          number_padding: number
          number_policy_updated_at: string
          number_prefix: string
          organization_id: string
          payment_term_count: number | null
          payment_terms: Json
          quote_acceptance_id: string
          quote_id: string
          quote_payment_schedule_id: string
          quote_version_id: string
          sequence_value: number
          source_content_sha256: string
          tax_amount: number
          total_amount: number
        }
        Insert: {
          approval_request_id: string
          approved_at: string
          approved_by: string
          bill_to_name: string
          currency: string
          deal_id: string
          draft_revision: number
          id?: string
          invoice_draft_id: string
          invoice_number: string
          issuance_sha256?: string
          issued_at?: string
          issued_by: string
          issuer_jurisdiction_country_code: string
          issuer_legal_name: string
          issuer_profile_updated_at: string
          issuer_registered_address: string
          issuer_tax_registration_id?: string | null
          line_count?: number | null
          line_items: Json
          net_amount: number
          number_padding: number
          number_policy_updated_at: string
          number_prefix: string
          organization_id: string
          payment_term_count?: number | null
          payment_terms: Json
          quote_acceptance_id: string
          quote_id: string
          quote_payment_schedule_id: string
          quote_version_id: string
          sequence_value: number
          source_content_sha256: string
          tax_amount: number
          total_amount: number
        }
        Update: {
          approval_request_id?: string
          approved_at?: string
          approved_by?: string
          bill_to_name?: string
          currency?: string
          deal_id?: string
          draft_revision?: number
          id?: string
          invoice_draft_id?: string
          invoice_number?: string
          issuance_sha256?: string
          issued_at?: string
          issued_by?: string
          issuer_jurisdiction_country_code?: string
          issuer_legal_name?: string
          issuer_profile_updated_at?: string
          issuer_registered_address?: string
          issuer_tax_registration_id?: string | null
          line_count?: number | null
          line_items?: Json
          net_amount?: number
          number_padding?: number
          number_policy_updated_at?: string
          number_prefix?: string
          organization_id?: string
          payment_term_count?: number | null
          payment_terms?: Json
          quote_acceptance_id?: string
          quote_id?: string
          quote_payment_schedule_id?: string
          quote_version_id?: string
          sequence_value?: number
          source_content_sha256?: string
          tax_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_issuances_approval_same_organization_fkey"
            columns: ["organization_id", "approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "invoice_issuances_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_issuances_exact_draft_fkey"
            columns: [
              "organization_id",
              "invoice_draft_id",
              "quote_id",
              "quote_version_id",
              "quote_acceptance_id",
              "quote_payment_schedule_id",
              "deal_id",
              "draft_revision",
              "source_content_sha256",
            ]
            isOneToOne: false
            referencedRelation: "invoice_drafts"
            referencedColumns: [
              "organization_id",
              "id",
              "quote_id",
              "quote_version_id",
              "quote_acceptance_id",
              "quote_payment_schedule_id",
              "deal_id",
              "revision",
              "content_sha256",
            ]
          },
          {
            foreignKeyName: "invoice_issuances_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_issuances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_issuer_profiles: {
        Row: {
          jurisdiction_country_code: string
          legal_name: string
          organization_id: string
          registered_address: string
          tax_registration_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          jurisdiction_country_code: string
          legal_name: string
          organization_id: string
          registered_address: string
          tax_registration_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          jurisdiction_country_code?: string
          legal_name?: string
          organization_id?: string
          registered_address?: string
          tax_registration_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_issuer_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_issuer_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_number_policies: {
        Row: {
          next_number: number
          number_padding: number
          number_prefix: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          next_number?: number
          number_padding?: number
          number_prefix?: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          next_number?: number
          number_padding?: number
          number_prefix?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_number_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_number_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      itinerary_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          trip_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          trip_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_comments_trip_organization_fkey"
            columns: ["trip_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      itinerary_items: {
        Row: {
          booking_id: string | null
          content: Json
          created_at: string
          day_number: number
          ends_at: string | null
          id: string
          item_type: string
          location: Json
          organization_id: string
          position: number
          starts_at: string | null
          title: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          content?: Json
          created_at?: string
          day_number: number
          ends_at?: string | null
          id?: string
          item_type: string
          location?: Json
          organization_id: string
          position?: number
          starts_at?: string | null
          title: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          content?: Json
          created_at?: string
          day_number?: number
          ends_at?: string | null
          id?: string
          item_type?: string
          location?: Json
          organization_id?: string
          position?: number
          starts_at?: string | null
          title?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_items_booking_same_organization_fkey"
            columns: ["organization_id", "booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "itinerary_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      itinerary_template_items: {
        Row: {
          content: Json
          created_at: string
          day_number: number
          id: string
          item_type: string
          itinerary_template_id: string
          location: Json
          organization_id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          day_number: number
          id?: string
          item_type: string
          itinerary_template_id: string
          location?: Json
          organization_id: string
          position: number
          title: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          day_number?: number
          id?: string
          item_type?: string
          itinerary_template_id?: string
          location?: Json
          organization_id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_template_items_template_organization_fkey"
            columns: ["itinerary_template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "itinerary_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      itinerary_templates: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_conflicts: {
        Row: {
          detected_at: string
          detection_reason: string
          id: string
          left_section_id: string
          organization_id: string
          resolution_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          right_section_id: string
          signal: Json
          status: Database["public"]["Enums"]["knowledge_conflict_status"]
          updated_at: string
        }
        Insert: {
          detected_at?: string
          detection_reason?: string
          id?: string
          left_section_id: string
          organization_id: string
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          right_section_id: string
          signal: Json
          status?: Database["public"]["Enums"]["knowledge_conflict_status"]
          updated_at?: string
        }
        Update: {
          detected_at?: string
          detection_reason?: string
          id?: string
          left_section_id?: string
          organization_id?: string
          resolution_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          right_section_id?: string
          signal?: Json
          status?: Database["public"]["Enums"]["knowledge_conflict_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_conflicts_left_section_same_organization_fkey"
            columns: ["organization_id", "left_section_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sections"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "knowledge_conflicts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_conflicts_reviewer_same_organization_fkey"
            columns: ["organization_id", "reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "knowledge_conflicts_right_section_same_organization_fkey"
            columns: ["organization_id", "right_section_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sections"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      knowledge_sections: {
        Row: {
          citation_label: string
          content: string
          created_at: string
          created_by: string
          heading: string
          id: string
          organization_id: string
          position: number
          search_document: unknown
          source_id: string
          updated_at: string
        }
        Insert: {
          citation_label: string
          content: string
          created_at?: string
          created_by: string
          heading: string
          id?: string
          organization_id: string
          position?: number
          search_document?: unknown
          source_id: string
          updated_at?: string
        }
        Update: {
          citation_label?: string
          content?: string
          created_at?: string
          created_by?: string
          heading?: string
          id?: string
          organization_id?: string
          position?: number
          search_document?: unknown
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sections_creator_same_organization_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "knowledge_sections_source_same_organization_fkey"
            columns: ["organization_id", "source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          created_at: string
          created_by: string
          id: string
          ingested_byte_size: number | null
          ingested_file_name: string | null
          ingested_file_sha256: string | null
          ingestion_method: string
          organization_id: string
          retired_at: string | null
          review_due_on: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_source_status"]
          summary: string | null
          supersedes_source_id: string | null
          title: string
          updated_at: string
          valid_from: string | null
          version_label: string
        }
        Insert: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          created_at?: string
          created_by: string
          id?: string
          ingested_byte_size?: number | null
          ingested_file_name?: string | null
          ingested_file_sha256?: string | null
          ingestion_method?: string
          organization_id: string
          retired_at?: string | null
          review_due_on?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["knowledge_source_status"]
          summary?: string | null
          supersedes_source_id?: string | null
          title: string
          updated_at?: string
          valid_from?: string | null
          version_label?: string
        }
        Update: {
          authority?: Database["public"]["Enums"]["knowledge_authority"]
          created_at?: string
          created_by?: string
          id?: string
          ingested_byte_size?: number | null
          ingested_file_name?: string | null
          ingested_file_sha256?: string | null
          ingestion_method?: string
          organization_id?: string
          retired_at?: string | null
          review_due_on?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          source_kind?: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["knowledge_source_status"]
          summary?: string | null
          supersedes_source_id?: string | null
          title?: string
          updated_at?: string
          valid_from?: string | null
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_creator_same_organization_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "knowledge_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_sources_reviewer_same_organization_fkey"
            columns: ["organization_id", "reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "knowledge_sources_supersedes_same_organization_fkey"
            columns: ["organization_id", "supersedes_source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      lead_capture_forms: {
        Row: {
          created_at: string
          created_by: string
          default_owner_id: string | null
          first_response_minutes: number
          headline: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          public_token: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_owner_id?: string | null
          first_response_minutes?: number
          headline?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          public_token?: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_owner_id?: string | null
          first_response_minutes?: number
          headline?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          public_token?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_capture_forms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_capture_forms_organization_id_default_owner_id_fkey"
            columns: ["organization_id", "default_owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "lead_capture_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_submissions: {
        Row: {
          budget_amount: number | null
          communication_consent: boolean
          contact_id: string | null
          created_at: string
          currency: string
          deal_id: string | null
          dedupe_key: string
          destination: string | null
          email: string | null
          full_name: string
          id: string
          landing_path: string | null
          lead_capture_form_id: string
          notes: string | null
          organization_id: string
          phone: string | null
          referrer_host: string | null
          status: string
          submitted_on: string
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          budget_amount?: number | null
          communication_consent?: boolean
          contact_id?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          dedupe_key: string
          destination?: string | null
          email?: string | null
          full_name: string
          id?: string
          landing_path?: string | null
          lead_capture_form_id: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          referrer_host?: string | null
          status?: string
          submitted_on?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          budget_amount?: number | null
          communication_consent?: boolean
          contact_id?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          dedupe_key?: string
          destination?: string | null
          email?: string | null
          full_name?: string
          id?: string
          landing_path?: string | null
          lead_capture_form_id?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          referrer_host?: string | null
          status?: string
          submitted_on?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_submissions_organization_id_contact_id_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_submissions_organization_id_deal_id_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lead_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_submissions_organization_id_lead_capture_form_id_fkey"
            columns: ["organization_id", "lead_capture_form_id"]
            isOneToOne: false
            referencedRelation: "lead_capture_forms"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_draft_reviews: {
        Row: {
          ai_run_id: string
          content_sha256: string
          decision: Database["public"]["Enums"]["message_draft_review_decision"]
          draft_updated_at: string
          id: string
          message_draft_id: string
          note: string | null
          organization_id: string
          reviewed_at: string
          reviewed_by: string
        }
        Insert: {
          ai_run_id: string
          content_sha256: string
          decision: Database["public"]["Enums"]["message_draft_review_decision"]
          draft_updated_at: string
          id?: string
          message_draft_id: string
          note?: string | null
          organization_id: string
          reviewed_at?: string
          reviewed_by: string
        }
        Update: {
          ai_run_id?: string
          content_sha256?: string
          decision?: Database["public"]["Enums"]["message_draft_review_decision"]
          draft_updated_at?: string
          id?: string
          message_draft_id?: string
          note?: string | null
          organization_id?: string
          reviewed_at?: string
          reviewed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_draft_reviews_draft_same_organization_fkey"
            columns: ["organization_id", "message_draft_id"]
            isOneToOne: false
            referencedRelation: "message_drafts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "message_draft_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_draft_reviews_reviewer_same_organization_fkey"
            columns: ["organization_id", "reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "message_draft_reviews_run_same_organization_fkey"
            columns: ["organization_id", "ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      message_drafts: {
        Row: {
          ai_run_id: string | null
          archived_at: string | null
          body: string
          channel: string
          conversation_id: string
          created_at: string
          created_by: string
          id: string
          organization_id: string
          recipient: string | null
          scheduled_for: string | null
          status: string
          subject: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          ai_run_id?: string | null
          archived_at?: string | null
          body: string
          channel?: string
          conversation_id: string
          created_at?: string
          created_by: string
          id?: string
          organization_id: string
          recipient?: string | null
          scheduled_for?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_run_id?: string | null
          archived_at?: string | null
          body?: string
          channel?: string
          conversation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          organization_id?: string
          recipient?: string | null
          scheduled_for?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_drafts_ai_run_same_organization_fkey"
            columns: ["organization_id", "ai_run_id"]
            isOneToOne: false
            referencedRelation: "ai_runs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "message_drafts_conversation_same_organization_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "message_drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_drafts_template_same_organization_fkey"
            columns: ["organization_id", "template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          organization_id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          organization_id: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          organization_id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_id: string | null
          body: string
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_id: string | null
          id: string
          organization_id: string
          sent_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          organization_id: string
          sent_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          organization_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_same_organization_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_exceptions: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          assigned_to: string | null
          created_at: string
          dedupe_key: string
          detected_at: string
          detected_by: string
          due_at: string | null
          evidence: Json
          exception_type: string
          id: string
          last_seen_at: string
          operator_note: string | null
          organization_id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_entity_id: string
          source_entity_type: string
          status: string
          summary: string
          title: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          assigned_to?: string | null
          created_at?: string
          dedupe_key: string
          detected_at?: string
          detected_by?: string
          due_at?: string | null
          evidence?: Json
          exception_type: string
          id?: string
          last_seen_at?: string
          operator_note?: string | null
          organization_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source_entity_id: string
          source_entity_type: string
          status?: string
          summary: string
          title: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          assigned_to?: string | null
          created_at?: string
          dedupe_key?: string
          detected_at?: string
          detected_by?: string
          due_at?: string | null
          evidence?: Json
          exception_type?: string
          id?: string
          last_seen_at?: string
          operator_note?: string | null
          organization_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_entity_id?: string
          source_entity_type?: string
          status?: string
          summary?: string
          title?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_exceptions_acknowledger_same_organization_fkey"
            columns: ["organization_id", "acknowledged_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "operational_exceptions_assignee_same_organization_fkey"
            columns: ["organization_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "operational_exceptions_resolver_same_organization_fkey"
            columns: ["organization_id", "resolved_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "operational_exceptions_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      operations_radar_policies: {
        Row: {
          confirmation_critical_hours: number
          confirmation_high_days: number
          confirmation_watch_days: number
          created_at: string
          default_assignee_id: string | null
          document_expiry_days: number
          document_high_days: number
          is_enabled: boolean
          last_run_at: string | null
          last_run_status: string | null
          next_run_at: string
          organization_id: string
          payment_due_days: number
          payment_high_days: number
          scan_interval_minutes: number
          task_critical_hours: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          confirmation_critical_hours?: number
          confirmation_high_days?: number
          confirmation_watch_days?: number
          created_at?: string
          default_assignee_id?: string | null
          document_expiry_days?: number
          document_high_days?: number
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          next_run_at?: string
          organization_id: string
          payment_due_days?: number
          payment_high_days?: number
          scan_interval_minutes?: number
          task_critical_hours?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          confirmation_critical_hours?: number
          confirmation_high_days?: number
          confirmation_watch_days?: number
          created_at?: string
          default_assignee_id?: string | null
          document_expiry_days?: number
          document_high_days?: number
          is_enabled?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          next_run_at?: string
          organization_id?: string
          payment_due_days?: number
          payment_high_days?: number
          scan_interval_minutes?: number
          task_critical_hours?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operations_radar_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_radar_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_radar_policy_assignee_same_organization_fkey"
            columns: ["organization_id", "default_assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      operations_radar_runs: {
        Row: {
          active_count: number | null
          created_at: string
          critical_count: number | null
          error_code: string | null
          finished_at: string | null
          id: string
          organization_id: string
          policy_snapshot: Json
          resolved_count: number | null
          scheduled_for: string
          started_at: string
          status: string
          trigger_type: string
          worker_id: string
        }
        Insert: {
          active_count?: number | null
          created_at?: string
          critical_count?: number | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          policy_snapshot: Json
          resolved_count?: number | null
          scheduled_for: string
          started_at?: string
          status?: string
          trigger_type: string
          worker_id: string
        }
        Update: {
          active_count?: number | null
          created_at?: string
          critical_count?: number | null
          error_code?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          policy_snapshot?: Json
          resolved_count?: number | null
          scheduled_for?: string
          started_at?: string
          status?: string
          trigger_type?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_radar_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          occurred_at: string
          organization_id: string
          payment_id: string
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          id?: string
          note?: string | null
          occurred_at: string
          organization_id: string
          payment_id: string
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          occurred_at?: string
          organization_id?: string
          payment_id?: string
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_same_organization_fkey"
            columns: ["organization_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_allocations_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_link_drafts: {
        Row: {
          created_at: string
          currency: string
          due_at: string | null
          evidence_sha256: string
          id: string
          invoice_issuance_id: string
          invoice_number: string
          organization_id: string
          paid_amount: number
          payment_amount: number
          payment_id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          payment_updated_at: string
          prepared_by: string
          requested_amount: number
          revision: number
          source_issuance_sha256: string
          status: string
          superseded_at: string | null
        }
        Insert: {
          created_at?: string
          currency: string
          due_at?: string | null
          evidence_sha256: string
          id?: string
          invoice_issuance_id: string
          invoice_number: string
          organization_id: string
          paid_amount: number
          payment_amount: number
          payment_id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          payment_updated_at: string
          prepared_by: string
          requested_amount: number
          revision: number
          source_issuance_sha256: string
          status?: string
          superseded_at?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          due_at?: string | null
          evidence_sha256?: string
          id?: string
          invoice_issuance_id?: string
          invoice_number?: string
          organization_id?: string
          paid_amount?: number
          payment_amount?: number
          payment_id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          payment_updated_at?: string
          prepared_by?: string
          requested_amount?: number
          revision?: number
          source_issuance_sha256?: string
          status?: string
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_link_drafts_issuance_same_organization_fkey"
            columns: ["organization_id", "invoice_issuance_id"]
            isOneToOne: false
            referencedRelation: "invoice_issuances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_link_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_link_drafts_payment_same_organization_fkey"
            columns: ["organization_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_link_drafts_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_link_executions: {
        Row: {
          adapter_version: string
          approval_request_id: string
          checkout_expires_at: string
          checkout_target: string
          checkout_token_sha256: string
          created_at: string
          currency: string
          executed_by: string
          id: string
          idempotency_key: string
          invalidated_at: string | null
          invoice_issuance_id: string
          organization_id: string
          payment_id: string
          payment_link_draft_id: string
          provider_environment: string
          provider_key: string
          provider_reference: string
          requested_amount: number
          source_evidence_sha256: string
          status: string
        }
        Insert: {
          adapter_version: string
          approval_request_id: string
          checkout_expires_at: string
          checkout_target: string
          checkout_token_sha256: string
          created_at?: string
          currency: string
          executed_by: string
          id?: string
          idempotency_key: string
          invalidated_at?: string | null
          invoice_issuance_id: string
          organization_id: string
          payment_id: string
          payment_link_draft_id: string
          provider_environment: string
          provider_key: string
          provider_reference: string
          requested_amount: number
          source_evidence_sha256: string
          status?: string
        }
        Update: {
          adapter_version?: string
          approval_request_id?: string
          checkout_expires_at?: string
          checkout_target?: string
          checkout_token_sha256?: string
          created_at?: string
          currency?: string
          executed_by?: string
          id?: string
          idempotency_key?: string
          invalidated_at?: string | null
          invoice_issuance_id?: string
          organization_id?: string
          payment_id?: string
          payment_link_draft_id?: string
          provider_environment?: string
          provider_key?: string
          provider_reference?: string
          requested_amount?: number
          source_evidence_sha256?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_link_executions_approval_same_organization_fkey"
            columns: ["organization_id", "approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_link_executions_draft_same_organization_fkey"
            columns: ["organization_id", "payment_link_draft_id"]
            isOneToOne: false
            referencedRelation: "payment_link_drafts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_link_executions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_link_executions_issuance_same_organization_fkey"
            columns: ["organization_id", "invoice_issuance_id"]
            isOneToOne: false
            referencedRelation: "invoice_issuances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payment_link_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_link_executions_payment_same_organization_fkey"
            columns: ["organization_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string | null
          description: string | null
          direction: string
          due_at: string | null
          id: string
          invoice_issuance_id: string | null
          invoice_number: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          provider_reference: string | null
          quote_acceptance_id: string | null
          quote_id: string | null
          quote_payment_schedule_id: string | null
          quote_schedule_item_position: number | null
          quote_version_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          status_note: string | null
          supplier_id: string | null
          title: string
          trip_id: string | null
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string | null
          description?: string | null
          direction: string
          due_at?: string | null
          id?: string
          invoice_issuance_id?: string | null
          invoice_number?: string | null
          organization_id: string
          paid_amount?: number
          paid_at?: string | null
          provider_reference?: string | null
          quote_acceptance_id?: string | null
          quote_id?: string | null
          quote_payment_schedule_id?: string | null
          quote_schedule_item_position?: number | null
          quote_version_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          status_note?: string | null
          supplier_id?: string | null
          title: string
          trip_id?: string | null
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string | null
          description?: string | null
          direction?: string
          due_at?: string | null
          id?: string
          invoice_issuance_id?: string | null
          invoice_number?: string | null
          organization_id?: string
          paid_amount?: number
          paid_at?: string | null
          provider_reference?: string | null
          quote_acceptance_id?: string | null
          quote_id?: string | null
          quote_payment_schedule_id?: string | null
          quote_schedule_item_position?: number | null
          quote_version_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          status_note?: string | null
          supplier_id?: string | null
          title?: string
          trip_id?: string | null
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_creator_same_organization_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "payments_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payments_invoice_issuance_same_organization_fkey"
            columns: ["organization_id", "invoice_issuance_id"]
            isOneToOne: false
            referencedRelation: "invoice_issuances"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_quote_acceptance_exact_version_fkey"
            columns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "quote_acceptance_id",
            ]
            isOneToOne: false
            referencedRelation: "quote_acceptances"
            referencedColumns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "payments_quote_schedule_exact_version_fkey"
            columns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "quote_payment_schedule_id",
            ]
            isOneToOne: false
            referencedRelation: "quote_payment_schedules"
            referencedColumns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "payments_supplier_same_organization_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payments_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "payments_voider_same_organization_fkey"
            columns: ["organization_id", "voided_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qualification_checklist_items: {
        Row: {
          created_at: string
          guidance: string | null
          id: string
          is_required: boolean
          label: string
          organization_id: string
          position: number
          template_id: string
        }
        Insert: {
          created_at?: string
          guidance?: string | null
          id?: string
          is_required?: boolean
          label: string
          organization_id: string
          position: number
          template_id: string
        }
        Update: {
          created_at?: string
          guidance?: string | null
          id?: string
          is_required?: boolean
          label?: string
          organization_id?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_checklist_items_organization_id_template_id_fkey"
            columns: ["organization_id", "template_id"]
            isOneToOne: false
            referencedRelation: "qualification_checklist_templates"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      qualification_checklist_templates: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_checklist_templat_organization_id_created_by_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "qualification_checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qualification_checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_acceptances: {
        Row: {
          accepted_at: string
          id: string
          organization_id: string
          quote_id: string
          quote_share_link_id: string
          quote_version_id: string
          signatory_name: string
          snapshot_sha256: string
          statement_version: number
        }
        Insert: {
          accepted_at?: string
          id?: string
          organization_id: string
          quote_id: string
          quote_share_link_id: string
          quote_version_id: string
          signatory_name: string
          snapshot_sha256: string
          statement_version?: number
        }
        Update: {
          accepted_at?: string
          id?: string
          organization_id?: string
          quote_id?: string
          quote_share_link_id?: string
          quote_version_id?: string
          signatory_name?: string
          snapshot_sha256?: string
          statement_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_acceptances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_acceptances_share_exact_version_fkey"
            columns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "quote_share_link_id",
            ]
            isOneToOne: false
            referencedRelation: "quote_share_links"
            referencedColumns: [
              "organization_id",
              "quote_id",
              "quote_version_id",
              "id",
            ]
          },
          {
            foreignKeyName: "quote_acceptances_version_same_organization_fkey"
            columns: ["organization_id", "quote_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "quote_id", "id"]
          },
        ]
      }
      quote_approval_policies: {
        Row: {
          commission_basis: string
          commission_percent: number
          created_at: string
          enforce_standard_terms: boolean
          maximum_discount_percent: number
          maximum_validity_days: number
          minimum_margin_percent: number
          minimum_markup_percent: number
          minimum_post_commission_margin_percent: number
          organization_id: string
          require_cost_estimate: boolean
          require_valid_until: boolean
          standard_terms: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          commission_basis?: string
          commission_percent?: number
          created_at?: string
          enforce_standard_terms?: boolean
          maximum_discount_percent?: number
          maximum_validity_days?: number
          minimum_margin_percent?: number
          minimum_markup_percent?: number
          minimum_post_commission_margin_percent?: number
          organization_id: string
          require_cost_estimate?: boolean
          require_valid_until?: boolean
          standard_terms?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          commission_basis?: string
          commission_percent?: number
          created_at?: string
          enforce_standard_terms?: boolean
          maximum_discount_percent?: number
          maximum_validity_days?: number
          minimum_margin_percent?: number
          minimum_markup_percent?: number
          minimum_post_commission_margin_percent?: number
          organization_id?: string
          require_cost_estimate?: boolean
          require_valid_until?: boolean
          standard_terms?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_approval_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approval_policies_updater_same_organization_fkey"
            columns: ["organization_id", "updated_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      quote_catalog_products: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          category: string
          created_at: string
          created_by: string
          currency: string
          description: string
          id: string
          name: string
          organization_id: string
          status: string
          supplier_id: string | null
          unit_label: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          category: string
          created_at?: string
          created_by: string
          currency: string
          description: string
          id?: string
          name: string
          organization_id: string
          status?: string
          supplier_id?: string | null
          unit_label?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          category?: string
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
          status?: string
          supplier_id?: string | null
          unit_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_catalog_products_archiver_same_organization_fkey"
            columns: ["organization_id", "archived_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "quote_catalog_products_creator_same_organization_fkey"
            columns: ["organization_id", "created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "quote_catalog_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_catalog_products_supplier_same_organization_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quote_catalog_rates: {
        Row: {
          id: string
          organization_id: string
          product_id: string
          published_at: string
          published_by: string
          tax_percent: number
          unit_cost_amount: number
          unit_sell_amount: number
          valid_from: string
          valid_until: string | null
          version: number
        }
        Insert: {
          id?: string
          organization_id: string
          product_id: string
          published_at?: string
          published_by: string
          tax_percent?: number
          unit_cost_amount: number
          unit_sell_amount: number
          valid_from: string
          valid_until?: string | null
          version: number
        }
        Update: {
          id?: string
          organization_id?: string
          product_id?: string
          published_at?: string
          published_by?: string
          tax_percent?: number
          unit_cost_amount?: number
          unit_sell_amount?: number
          valid_from?: string
          valid_until?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_catalog_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_catalog_rates_product_same_organization_fkey"
            columns: ["organization_id", "product_id"]
            isOneToOne: false
            referencedRelation: "quote_catalog_products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quote_catalog_rates_publisher_same_organization_fkey"
            columns: ["organization_id", "published_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      quote_cost_estimates: {
        Row: {
          created_at: string
          created_by: string | null
          estimated_cost_amount: number
          id: string
          organization_id: string
          quote_version_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimated_cost_amount: number
          id?: string
          organization_id: string
          quote_version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimated_cost_amount?: number
          id?: string
          organization_id?: string
          quote_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_cost_estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_cost_estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_cost_estimates_quote_version_same_organization_fkey"
            columns: ["organization_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quote_line_costs: {
        Row: {
          cost_amount: number
          created_at: string
          organization_id: string
          quote_line_item_id: string
          unit_cost_amount: number
        }
        Insert: {
          cost_amount: number
          created_at?: string
          organization_id: string
          quote_line_item_id: string
          unit_cost_amount: number
        }
        Update: {
          cost_amount?: number
          created_at?: string
          organization_id?: string
          quote_line_item_id?: string
          unit_cost_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_costs_same_organization_fkey"
            columns: ["organization_id", "quote_line_item_id"]
            isOneToOne: false
            referencedRelation: "quote_line_items"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quote_line_items: {
        Row: {
          catalog_product_id: string | null
          catalog_rate_id: string | null
          category: string
          created_at: string
          description: string
          discount_amount: number
          id: string
          net_amount: number
          organization_id: string
          position: number
          quantity: number
          quote_version_id: string
          supplier_id: string | null
          tax_amount: number
          tax_percent: number
          total_amount: number
          unit_price_amount: number
        }
        Insert: {
          catalog_product_id?: string | null
          catalog_rate_id?: string | null
          category: string
          created_at?: string
          description: string
          discount_amount?: number
          id?: string
          net_amount: number
          organization_id: string
          position: number
          quantity: number
          quote_version_id: string
          supplier_id?: string | null
          tax_amount: number
          tax_percent?: number
          total_amount: number
          unit_price_amount: number
        }
        Update: {
          catalog_product_id?: string | null
          catalog_rate_id?: string | null
          category?: string
          created_at?: string
          description?: string
          discount_amount?: number
          id?: string
          net_amount?: number
          organization_id?: string
          position?: number
          quantity?: number
          quote_version_id?: string
          supplier_id?: string | null
          tax_amount?: number
          tax_percent?: number
          total_amount?: number
          unit_price_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_items_catalog_product_same_organization_fkey"
            columns: ["organization_id", "catalog_product_id"]
            isOneToOne: false
            referencedRelation: "quote_catalog_products"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quote_line_items_catalog_rate_same_organization_fkey"
            columns: ["organization_id", "catalog_rate_id"]
            isOneToOne: false
            referencedRelation: "quote_catalog_rates"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quote_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_items_quote_version_id_fkey"
            columns: ["quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_items_supplier_same_organization_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quote_line_items_version_same_organization_fkey"
            columns: ["organization_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quote_payment_schedules: {
        Row: {
          content_sha256: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          item_count: number | null
          items: Json
          organization_id: string
          quote_id: string
          quote_version_id: string
          revision: number
          status: string
          superseded_at: string | null
          superseded_by: string | null
          total_amount: number
        }
        Insert: {
          content_sha256: string
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          item_count?: number | null
          items: Json
          organization_id: string
          quote_id: string
          quote_version_id: string
          revision: number
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          total_amount: number
        }
        Update: {
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          item_count?: number | null
          items?: Json
          organization_id?: string
          quote_id?: string
          quote_version_id?: string
          revision?: number
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_payment_schedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_payment_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_payment_schedules_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_payment_schedules_version_same_organization_fkey"
            columns: ["organization_id", "quote_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "quote_id", "id"]
          },
        ]
      }
      quote_share_links: {
        Row: {
          approval_request_id: string
          approved_by: string | null
          created_at: string
          expired_at: string | null
          expires_at: string
          id: string
          organization_id: string
          published_at: string
          published_by: string | null
          quote_id: string
          quote_version_id: string
          revocation_note: string | null
          revoked_at: string | null
          revoked_by: string | null
          snapshot: Json
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          approval_request_id: string
          approved_by?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at: string
          id?: string
          organization_id: string
          published_at?: string
          published_by?: string | null
          quote_id: string
          quote_version_id: string
          revocation_note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          snapshot: Json
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          approval_request_id?: string
          approved_by?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          published_at?: string
          published_by?: string | null
          quote_id?: string
          quote_version_id?: string
          revocation_note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          snapshot?: Json
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_share_links_approval_same_organization_fkey"
            columns: ["organization_id", "approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quote_share_links_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_share_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_share_links_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_share_links_quote_version_same_organization_fkey"
            columns: ["organization_id", "quote_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "quote_id", "id"]
          },
          {
            foreignKeyName: "quote_share_links_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_version_commercial_terms: {
        Row: {
          commission_base_amount: number
          commission_basis: string
          commission_percent: number
          created_at: string
          created_by: string | null
          estimated_commission_amount: number
          estimated_cost_amount: number
          gross_markup_amount: number
          gross_markup_percent: number | null
          net_sell_amount: number
          organization_id: string
          policy_updated_at: string
          post_commission_margin_amount: number
          post_commission_margin_percent: number | null
          quote_version_id: string
        }
        Insert: {
          commission_base_amount: number
          commission_basis: string
          commission_percent: number
          created_at?: string
          created_by?: string | null
          estimated_commission_amount: number
          estimated_cost_amount: number
          gross_markup_amount: number
          gross_markup_percent?: number | null
          net_sell_amount: number
          organization_id: string
          policy_updated_at: string
          post_commission_margin_amount: number
          post_commission_margin_percent?: number | null
          quote_version_id: string
        }
        Update: {
          commission_base_amount?: number
          commission_basis?: string
          commission_percent?: number
          created_at?: string
          created_by?: string | null
          estimated_commission_amount?: number
          estimated_cost_amount?: number
          gross_markup_amount?: number
          gross_markup_percent?: number | null
          net_sell_amount?: number
          organization_id?: string
          policy_updated_at?: string
          post_commission_margin_amount?: number
          post_commission_margin_percent?: number | null
          quote_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_version_commercial_terms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_version_commercial_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_version_commercial_terms_version_same_org_fkey"
            columns: ["organization_id", "quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quote_versions: {
        Row: {
          cost_lines: Json
          created_at: string
          created_by: string | null
          id: string
          itinerary_snapshot: Json
          margin_amount: number | null
          margin_percent: number | null
          net_amount: number
          organization_id: string
          quote_id: string
          tax_amount: number
          terms_snapshot: Json
          total_amount: number
          version: number
        }
        Insert: {
          cost_lines?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          itinerary_snapshot?: Json
          margin_amount?: number | null
          margin_percent?: number | null
          net_amount?: number
          organization_id: string
          quote_id: string
          tax_amount?: number
          terms_snapshot?: Json
          total_amount?: number
          version: number
        }
        Update: {
          cost_lines?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          itinerary_snapshot?: Json
          margin_amount?: number | null
          margin_percent?: number | null
          net_amount?: number
          organization_id?: string
          quote_id?: string
          tax_amount?: number
          terms_snapshot?: Json
          total_amount?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_quote_same_organization_fkey"
            columns: ["organization_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          created_at: string
          currency: string
          current_version: number
          deal_id: string
          id: string
          organization_id: string
          owner_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          title: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          currency?: string
          current_version?: number
          deal_id: string
          id?: string
          organization_id: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          title: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          currency?: string
          current_version?: number
          deal_id?: string
          id?: string
          organization_id?: string
          owner_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          title?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_owner_same_organization_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      saved_views: {
        Row: {
          created_at: string
          feature: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          role_title: string | null
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          role_title?: string | null
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          role_title?: string | null
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_contacts_supplier_same_organization_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      supplier_contracts: {
        Row: {
          cancellation_terms: string | null
          contract_reference: string | null
          created_at: string
          created_by: string | null
          currency: string
          ends_on: string | null
          id: string
          internal_notes: string | null
          organization_id: string
          payment_terms_days: number | null
          starts_on: string | null
          status: string
          supplier_id: string
          title: string
          updated_at: string
        }
        Insert: {
          cancellation_terms?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          ends_on?: string | null
          id?: string
          internal_notes?: string | null
          organization_id: string
          payment_terms_days?: number | null
          starts_on?: string | null
          status?: string
          supplier_id: string
          title: string
          updated_at?: string
        }
        Update: {
          cancellation_terms?: string | null
          contract_reference?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          ends_on?: string | null
          id?: string
          internal_notes?: string | null
          organization_id?: string
          payment_terms_days?: number | null
          starts_on?: string | null
          status?: string
          supplier_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_contracts_supplier_same_organization_fkey"
            columns: ["organization_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      suppliers: {
        Row: {
          archived_at: string | null
          cancellation_terms: string | null
          category: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          internal_notes: string | null
          name: string
          organization_id: string
          payment_terms_days: number | null
          phone: string | null
          preferred_currency: string
          quality_rating: number | null
          status: string
          terms: Json
          updated_at: string
          website: string | null
        }
        Insert: {
          archived_at?: string | null
          cancellation_terms?: string | null
          category?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          internal_notes?: string | null
          name: string
          organization_id: string
          payment_terms_days?: number | null
          phone?: string | null
          preferred_currency?: string
          quality_rating?: number | null
          status?: string
          terms?: Json
          updated_at?: string
          website?: string | null
        }
        Update: {
          archived_at?: string | null
          cancellation_terms?: string | null
          category?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          internal_notes?: string | null
          name?: string
          organization_id?: string
          payment_terms_days?: number | null
          phone?: string | null
          preferred_currency?: string
          quality_rating?: number | null
          status?: string
          terms?: Json
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          deal_id: string | null
          due_at: string | null
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deal_id?: string | null
          due_at?: string | null
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deal_id?: string | null
          due_at?: string | null
          id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_same_organization_fkey"
            columns: ["organization_id", "assignee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "tasks_conversation_same_organization_fkey"
            columns: ["organization_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "tasks_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      traveler_entry_checks: {
        Row: {
          action_due_on: string | null
          citizenship_country_code: string
          created_at: string
          destination_country_code: string
          evidence_source_label: string | null
          evidence_source_url: string | null
          id: string
          organization_id: string
          passport_expires_on: string | null
          passport_issuing_country_code: string | null
          passport_validity_months_required: number
          reviewed_at: string
          reviewed_by: string | null
          traveler_id: string
          trip_id: string
          updated_at: string
          visa_requirement: string
          visa_status: string
          visa_valid_until: string | null
        }
        Insert: {
          action_due_on?: string | null
          citizenship_country_code: string
          created_at?: string
          destination_country_code: string
          evidence_source_label?: string | null
          evidence_source_url?: string | null
          id?: string
          organization_id: string
          passport_expires_on?: string | null
          passport_issuing_country_code?: string | null
          passport_validity_months_required?: number
          reviewed_at?: string
          reviewed_by?: string | null
          traveler_id: string
          trip_id: string
          updated_at?: string
          visa_requirement?: string
          visa_status?: string
          visa_valid_until?: string | null
        }
        Update: {
          action_due_on?: string | null
          citizenship_country_code?: string
          created_at?: string
          destination_country_code?: string
          evidence_source_label?: string | null
          evidence_source_url?: string | null
          id?: string
          organization_id?: string
          passport_expires_on?: string | null
          passport_issuing_country_code?: string | null
          passport_validity_months_required?: number
          reviewed_at?: string
          reviewed_by?: string | null
          traveler_id?: string
          trip_id?: string
          updated_at?: string
          visa_requirement?: string
          visa_status?: string
          visa_valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "traveler_entry_checks_reviewer_same_organization_fkey"
            columns: ["organization_id", "reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "traveler_entry_checks_traveler_same_trip_fkey"
            columns: ["organization_id", "trip_id", "traveler_id"]
            isOneToOne: false
            referencedRelation: "travelers"
            referencedColumns: ["organization_id", "trip_id", "id"]
          },
        ]
      }
      travelers: {
        Row: {
          contact_id: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          organization_id: string
          phone: string | null
          preferences: Json
          role: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          organization_id: string
          phone?: string | null
          preferences?: Json
          role?: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          organization_id?: string
          phone?: string | null
          preferences?: Json
          role?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "travelers_contact_same_organization_fkey"
            columns: ["organization_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "travelers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travelers_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      trip_portal_documents: {
        Row: {
          created_at: string
          document_id: string
          organization_id: string
          portal_link_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          organization_id: string
          portal_link_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          organization_id?: string
          portal_link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_portal_documents_document_same_organization_fkey"
            columns: ["organization_id", "document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "trip_portal_documents_link_same_organization_fkey"
            columns: ["organization_id", "portal_link_id"]
            isOneToOne: false
            referencedRelation: "trip_portal_links"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "trip_portal_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_portal_links: {
        Row: {
          approval_request_id: string
          approved_by: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          organization_id: string
          revocation_note: string | null
          revoked_at: string | null
          revoked_by: string | null
          snapshot: Json
          status: string
          token_hash: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          approval_request_id: string
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          organization_id: string
          revocation_note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          snapshot: Json
          status?: string
          token_hash: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          approval_request_id?: string
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          revocation_note?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          snapshot?: Json
          status?: string
          token_hash?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_portal_links_approval_same_organization_fkey"
            columns: ["organization_id", "approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "trip_portal_links_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_portal_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_portal_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_portal_links_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_portal_links_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      trip_status_history: {
        Row: {
          change_source: string
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["trip_status"] | null
          id: string
          note: string | null
          organization_id: string
          to_status: Database["public"]["Enums"]["trip_status"]
          trip_id: string
        }
        Insert: {
          change_source?: string
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["trip_status"] | null
          id?: string
          note?: string | null
          organization_id: string
          to_status: Database["public"]["Enums"]["trip_status"]
          trip_id: string
        }
        Update: {
          change_source?: string
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["trip_status"] | null
          id?: string
          note?: string | null
          organization_id?: string
          to_status?: Database["public"]["Enums"]["trip_status"]
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_status_history_actor_same_organization_fkey"
            columns: ["organization_id", "changed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "trip_status_history_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      trips: {
        Row: {
          converted_at: string | null
          converted_by: string | null
          created_at: string
          currency: string
          deal_id: string | null
          destination: string | null
          end_date: string | null
          id: string
          name: string
          operations_notes: string | null
          organization_id: string
          owner_id: string | null
          quote_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
        }
        Insert: {
          converted_at?: string | null
          converted_by?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          destination?: string | null
          end_date?: string | null
          id?: string
          name: string
          operations_notes?: string | null
          organization_id: string
          owner_id?: string | null
          quote_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Update: {
          converted_at?: string | null
          converted_by?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          destination?: string | null
          end_date?: string | null
          id?: string
          name?: string
          operations_notes?: string | null
          organization_id?: string
          owner_id?: string | null
          quote_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_converted_by_same_organization_fkey"
            columns: ["organization_id", "converted_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "trips_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_owner_same_organization_fkey"
            columns: ["organization_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["organization_id", "user_id"]
          },
          {
            foreignKeyName: "trips_quote_same_organization_fkey"
            columns: ["organization_id", "quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_organization_invitation: {
        Args: { invitation_token_hash: string }
        Returns: {
          membership_role: Database["public"]["Enums"]["app_role"]
          organization_id: string
          organization_name: string
        }[]
      }
      accept_quote_share: {
        Args: {
          target_signatory_name: string
          target_statement_version: number
          target_token_hash: string
        }
        Returns: {
          acceptance_id: string
          accepted_at: string
          already_accepted: boolean
          quote_id: string
        }[]
      }
      acknowledge_lead_response: {
        Args: { target_deal_id: string; target_organization_id: string }
        Returns: {
          archived_at: string | null
          contact_id: string | null
          created_at: string
          currency: string
          destination: string | null
          expected_close_at: string | null
          first_responded_at: string | null
          first_response_due_at: string | null
          follow_up_due_at: string | null
          id: string
          last_activity_at: string | null
          lost_at: string | null
          lost_reason: string | null
          next_step: string | null
          notes: string | null
          organization_id: string
          owner_id: string | null
          probability: number
          qualified_at: string | null
          sla_escalated_at: string | null
          sla_escalation_level: number
          source: string | null
          source_campaign: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at: string
          title: string
          travel_end: string | null
          travel_start: string | null
          traveller_count: number | null
          updated_at: string
          value_amount: number | null
          won_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      add_knowledge_section: {
        Args: {
          target_citation_label: string
          target_content: string
          target_heading: string
          target_organization_id: string
          target_position?: number
          target_source_id: string
        }
        Returns: {
          citation_label: string
          content: string
          created_at: string
          created_by: string
          heading: string
          id: string
          organization_id: string
          position: number
          search_document: unknown
          source_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      append_itinerary_item: {
        Args: {
          target_day_number: number
          target_item_type: string
          target_location_name: string
          target_notes: string
          target_organization_id: string
          target_title: string
          target_trip_id: string
        }
        Returns: {
          itinerary_item_id: string
        }[]
      }
      append_itinerary_template_to_trip: {
        Args: {
          target_organization_id: string
          target_template_id: string
          target_trip_id: string
        }
        Returns: number
      }
      append_quote_payment_schedule: {
        Args: {
          target_items: Json
          target_organization_id: string
          target_quote_id: string
        }
        Returns: {
          content_sha256: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          item_count: number | null
          items: Json
          organization_id: string
          quote_id: string
          quote_version_id: string
          revision: number
          status: string
          superseded_at: string | null
          superseded_by: string | null
          total_amount: number
        }[]
        SetofOptions: {
          from: "*"
          to: "quote_payment_schedules"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      append_quote_proposal_content_version: {
        Args: {
          target_content: Json
          target_organization_id: string
          target_quote_id: string
        }
        Returns: {
          quote_version: number
          quote_version_id: string
        }[]
      }
      append_quote_version: {
        Args: {
          quote_total_amount: number
          target_organization_id: string
          target_quote_id: string
        }
        Returns: {
          quote_version: number
        }[]
      }
      append_quote_version_with_cost: {
        Args: {
          quote_estimated_cost_amount: number
          quote_total_amount: number
          target_organization_id: string
          target_quote_id: string
        }
        Returns: {
          quote_version: number
        }[]
      }
      append_structured_quote_version: {
        Args: {
          target_items: Json
          target_organization_id: string
          target_quote_id: string
        }
        Returns: {
          customer_total_amount: number
          estimated_cost_amount: number
          gross_margin_amount: number
          gross_margin_percent: number
          net_sell_amount: number
          quote_version: number
          quote_version_id: string
          tax_total_amount: number
        }[]
      }
      apply_follow_up_sequence: {
        Args: {
          target_deal_id: string
          target_organization_id: string
          target_sequence_id: string
        }
        Returns: {
          run_id: string
          tasks_created: number
        }[]
      }
      apply_qualification_checklist: {
        Args: {
          target_deal_id: string
          target_organization_id: string
          target_template_id: string
        }
        Returns: number
      }
      capture_public_lead: {
        Args: {
          target_budget_amount: number
          target_communication_consent: boolean
          target_currency: string
          target_dedupe_key: string
          target_destination: string
          target_email: string
          target_form_token: string
          target_full_name: string
          target_landing_path: string
          target_notes: string
          target_phone: string
          target_referrer_host: string
          target_request_fingerprint: string
          target_utm_campaign: string
          target_utm_medium: string
          target_utm_source: string
        }
        Returns: {
          contact_id: string
          deal_id: string
          duplicate: boolean
          submission_id: string
        }[]
      }
      claim_ai_job: {
        Args: { target_job_id: string; target_worker_id: string }
        Returns: {
          claimed_job_type: Database["public"]["Enums"]["ai_job_type"]
          job_ai_run_id: string
          job_attempts: number
          job_id: string
          job_max_attempts: number
          job_organization_id: string
          job_payload: Json
        }[]
      }
      claim_analytics_report_runs: {
        Args: {
          target_force?: boolean
          target_limit?: number
          target_organization_id?: string
          target_worker_id: string
        }
        Returns: {
          organization_id: string
          report_forecast_horizon_days: number
          report_period_days: number
          run_id: string
          trigger_type: string
        }[]
      }
      claim_operations_radar_runs: {
        Args: {
          target_force?: boolean
          target_limit?: number
          target_organization_id?: string
          target_worker_id: string
        }
        Returns: {
          organization_id: string
          run_id: string
          trigger_type: string
        }[]
      }
      classify_trip_document: {
        Args: {
          target_document_id: string
          target_document_kind: string
          target_organization_id: string
          target_trip_id: string
        }
        Returns: {
          byte_size: number
          contact_id: string | null
          created_at: string
          document_kind: string
          expires_at: string | null
          file_name: string
          id: string
          mime_type: string
          organization_id: string
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          storage_path: string
          trip_id: string | null
          uploaded_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      convert_won_deal_to_trip: {
        Args: { target_deal_id: string; target_organization_id: string }
        Returns: {
          converted_at: string | null
          converted_by: string | null
          created_at: string
          currency: string
          deal_id: string | null
          destination: string | null
          end_date: string | null
          id: string
          name: string
          operations_notes: string | null
          organization_id: string
          owner_id: string | null
          quote_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_accepted_quote_receivables: {
        Args: { target_organization_id: string; target_quote_id: string }
        Returns: {
          already_created: boolean
          currency: string
          quote_acceptance_id: string
          quote_id: string
          quote_payment_schedule_id: string
          receivable_count: number
          total_amount: number
        }[]
      }
      create_follow_up_sequence: {
        Args: {
          target_description: string
          target_name: string
          target_organization_id: string
          target_steps: Json
        }
        Returns: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "follow_up_sequences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_itinerary_template_from_trip: {
        Args: {
          source_trip_id: string
          target_organization_id: string
          template_description?: string
          template_name: string
        }
        Returns: string
      }
      create_payment_obligation: {
        Args: {
          target_amount: number
          target_currency: string
          target_deal_id?: string
          target_description?: string
          target_direction: string
          target_due_at?: string
          target_invoice_number?: string
          target_organization_id: string
          target_supplier_id?: string
          target_title: string
          target_trip_id?: string
        }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string | null
          description: string | null
          direction: string
          due_at: string | null
          id: string
          invoice_issuance_id: string | null
          invoice_number: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          provider_reference: string | null
          quote_acceptance_id: string | null
          quote_id: string | null
          quote_payment_schedule_id: string | null
          quote_schedule_item_position: number | null
          quote_version_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          status_note: string | null
          supplier_id: string | null
          title: string
          trip_id: string | null
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_qualification_checklist_template: {
        Args: {
          target_description: string
          target_items: Json
          target_name: string
          target_organization_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "qualification_checklist_templates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_quote_catalog_product: {
        Args: {
          target_category: string
          target_currency: string
          target_description: string
          target_name: string
          target_organization_id: string
          target_supplier_id: string
          target_tax_percent: number
          target_unit_cost_amount: number
          target_unit_label: string
          target_unit_sell_amount: number
          target_valid_from: string
          target_valid_until: string
        }
        Returns: {
          product_id: string
          rate_id: string
          rate_version: number
        }[]
      }
      create_quote_draft: {
        Args: {
          quote_currency: string
          quote_title: string
          quote_total_amount: number
          quote_valid_until: string
          target_deal_id: string
          target_organization_id: string
        }
        Returns: {
          quote_id: string
        }[]
      }
      dead_letter_ai_job: {
        Args: {
          target_error_code: string
          target_job_id: string
          target_worker_id: string
        }
        Returns: {
          job_attempts: number
          job_id: string
          job_status: Database["public"]["Enums"]["ai_job_status"]
        }[]
      }
      delete_knowledge_section: {
        Args: {
          target_organization_id: string
          target_section_id: string
          target_source_id: string
        }
        Returns: boolean
      }
      get_quote_share_snapshot: {
        Args: { target_token_hash: string }
        Returns: Json
      }
      get_sales_copilot_quality_summary: {
        Args: { target_organization_id: string }
        Returns: {
          active_ai_drafts: number
          approved_decisions: number
          change_requested_decisions: number
          current_revision_approved: number
          current_revision_attention: number
          first_pass_approved: number
          initial_feedback_drafts: number
          latest_reviewed_at: string
          recovered_after_feedback: number
          rejected_decisions: number
          review_decisions: number
          reviewed_drafts: number
          total_ai_drafts: number
        }[]
      }
      get_sandbox_payment_checkout: {
        Args: { target_checkout_token_sha256: string }
        Returns: {
          checkout_expires_at: string
          currency: string
          invoice_number: string
          provider_reference: string
          requested_amount: number
          sandbox_status: string
        }[]
      }
      get_traveler_portal_document: {
        Args: { target_document_id: string; target_token_hash: string }
        Returns: {
          file_name: string
          mime_type: string
          storage_path: string
        }[]
      }
      get_traveler_portal_snapshot: {
        Args: { target_token_hash: string }
        Returns: Json
      }
      has_organization_role: {
        Args: {
          permitted_roles: Database["public"]["Enums"]["app_role"][]
          target_organization_id: string
        }
        Returns: boolean
      }
      import_knowledge_text_source: {
        Args: {
          target_authority: Database["public"]["Enums"]["knowledge_authority"]
          target_byte_size: number
          target_file_name: string
          target_file_sha256: string
          target_organization_id: string
          target_review_due_on?: string
          target_sections: Json
          target_sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          target_source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          target_source_url?: string
          target_summary?: string
          target_title: string
          target_valid_from?: string
          target_version_label: string
        }
        Returns: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          created_at: string
          created_by: string
          id: string
          ingested_byte_size: number | null
          ingested_file_name: string | null
          ingested_file_sha256: string | null
          ingestion_method: string
          organization_id: string
          retired_at: string | null
          review_due_on: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_source_status"]
          summary: string | null
          supersedes_source_id: string | null
          title: string
          updated_at: string
          valid_from: string | null
          version_label: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      is_active_member: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      issue_approved_invoice: {
        Args: {
          target_approval_request_id: string
          target_invoice_draft_id: string
          target_organization_id: string
        }
        Returns: {
          already_issued: boolean
          currency: string
          invoice_issuance_id: string
          invoice_number: string
          issuance_sha256: string
          issued_at: string
          linked_receivable_count: number
          total_amount: number
        }[]
      }
      list_quote_share_links: {
        Args: { target_organization_id: string }
        Returns: {
          approval_request_id: string
          effective_status: string
          expires_at: string
          id: string
          published_at: string
          quote_id: string
          quote_version_id: string
          revoked_at: string
          status: string
        }[]
      }
      meets_mfa_requirement: { Args: never; Returns: boolean }
      merge_duplicate_contacts: {
        Args: {
          duplicate_contact_id: string
          primary_contact_id: string
          target_organization_id: string
        }
        Returns: {
          archived_contact_id: string
          surviving_contact_id: string
        }[]
      }
      prepare_accepted_quote_invoice_draft: {
        Args: { target_organization_id: string; target_quote_id: string }
        Returns: {
          already_prepared: boolean
          currency: string
          invoice_draft_id: string
          line_count: number
          number_preview: string
          payment_term_count: number
          revision: number
          total_amount: number
        }[]
      }
      prepare_payment_link_draft: {
        Args: { target_organization_id: string; target_payment_id: string }
        Returns: {
          already_prepared: boolean
          currency: string
          evidence_sha256: string
          payment_link_draft_id: string
          requested_amount: number
          revision: number
        }[]
      }
      publish_quote_catalog_rate: {
        Args: {
          target_organization_id: string
          target_product_id: string
          target_tax_percent: number
          target_unit_cost_amount: number
          target_unit_sell_amount: number
          target_valid_from: string
          target_valid_until: string
        }
        Returns: {
          rate_id: string
          rate_version: number
        }[]
      }
      publish_quote_share: {
        Args: {
          target_approval_id: string
          target_expires_at: string
          target_organization_id: string
          target_quote_id: string
          target_token_hash: string
        }
        Returns: {
          expires_at: string
          published_at: string
          quote_version: number
          share_link_id: string
          share_status: string
        }[]
      }
      publish_traveler_portal: {
        Args: {
          target_approval_id: string
          target_organization_id: string
          target_token_hash: string
          target_trip_id: string
        }
        Returns: {
          approval_request_id: string
          approved_by: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          organization_id: string
          revocation_note: string | null
          revoked_at: string | null
          revoked_by: string | null
          snapshot: Json
          status: string
          token_hash: string
          trip_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trip_portal_links"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_invoice_document_render: {
        Args: {
          target_byte_size: number
          target_content_sha256: string
          target_file_name: string
          target_generated_by: string
          target_invoice_issuance_id: string
          target_organization_id: string
          target_renderer_version: string
          target_source_issuance_sha256: string
          target_storage_path: string
        }
        Returns: {
          already_rendered: boolean
          byte_size: number
          compliance_status: string
          content_sha256: string
          file_name: string
          generated_at: string
          invoice_document_id: string
          invoice_number: string
          renderer_version: string
        }[]
      }
      record_payment_allocation: {
        Args: {
          target_amount: number
          target_note?: string
          target_occurred_at: string
          target_organization_id: string
          target_payment_id: string
          target_reference?: string
        }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string | null
          description: string | null
          direction: string
          due_at: string | null
          id: string
          invoice_issuance_id: string | null
          invoice_number: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          provider_reference: string | null
          quote_acceptance_id: string | null
          quote_id: string | null
          quote_payment_schedule_id: string | null
          quote_schedule_item_position: number | null
          quote_version_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          status_note: string | null
          supplier_id: string | null
          title: string
          trip_id: string | null
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_payment_link_execution: {
        Args: {
          target_adapter_version: string
          target_approval_request_id: string
          target_checkout_expires_at: string
          target_checkout_target: string
          target_checkout_token_sha256: string
          target_executed_by: string
          target_idempotency_key: string
          target_organization_id: string
          target_payment_link_draft_id: string
          target_provider_environment: string
          target_provider_key: string
          target_provider_reference: string
        }
        Returns: {
          adapter_version: string
          already_executed: boolean
          checkout_expires_at: string
          checkout_target: string
          created_at: string
          execution_status: string
          idempotency_key: string
          payment_link_execution_id: string
          provider_environment: string
          provider_key: string
          provider_reference: string
        }[]
      }
      record_travel_document: {
        Args: {
          target_byte_size: number
          target_contact_id: string
          target_deal_id: string
          target_document_id: string
          target_file_name: string
          target_mime_type: string
          target_organization_id: string
          target_storage_path: string
        }
        Returns: {
          byte_size: number
          contact_id: string | null
          created_at: string
          document_kind: string
          expires_at: string | null
          file_name: string
          id: string
          mime_type: string
          organization_id: string
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          storage_path: string
          trip_id: string | null
          uploaded_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_trip_document: {
        Args: {
          target_byte_size: number
          target_document_id: string
          target_expires_at?: string
          target_file_name: string
          target_mime_type: string
          target_organization_id: string
          target_storage_path: string
          target_trip_id: string
        }
        Returns: {
          byte_size: number
          contact_id: string | null
          created_at: string
          document_kind: string
          expires_at: string | null
          file_name: string
          id: string
          mime_type: string
          organization_id: string
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          storage_path: string
          trip_id: string | null
          uploaded_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      refresh_operational_exceptions: {
        Args: { target_organization_id: string }
        Returns: {
          active_count: number
          critical_count: number
          resolved_count: number
          scanned_at: string
        }[]
      }
      refresh_payment_obligation_statuses: {
        Args: { target_organization_id: string }
        Returns: {
          open_count: number
          overdue_count: number
          refreshed_at: string
          updated_count: number
        }[]
      }
      renew_knowledge_source: {
        Args: {
          target_organization_id: string
          target_review_due_on: string
          target_source_id: string
          target_valid_from?: string
          target_version_label: string
        }
        Returns: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          created_at: string
          created_by: string
          id: string
          ingested_byte_size: number | null
          ingested_file_name: string | null
          ingested_file_sha256: string | null
          ingestion_method: string
          organization_id: string
          retired_at: string | null
          review_due_on: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_source_status"]
          summary: string | null
          supersedes_source_id: string | null
          title: string
          updated_at: string
          valid_from: string | null
          version_label: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_invoice_issuance_approval: {
        Args: {
          target_invoice_draft_id: string
          target_organization_id: string
          target_rationale: string
        }
        Returns: {
          already_requested: boolean
          approval_request_id: string
          approval_status: Database["public"]["Enums"]["approval_status"]
          expires_at: string
        }[]
      }
      request_payment_link_approval: {
        Args: {
          target_organization_id: string
          target_payment_link_draft_id: string
          target_rationale: string
        }
        Returns: {
          already_requested: boolean
          approval_request_id: string
          approval_status: Database["public"]["Enums"]["approval_status"]
          expires_at: string
        }[]
      }
      requeue_ai_job: {
        Args: { target_job_id: string }
        Returns: {
          job_attempts: number
          job_available_at: string
          job_id: string
          job_status: Database["public"]["Enums"]["ai_job_status"]
        }[]
      }
      resolve_approval_request: {
        Args: {
          target_approval_id: string
          target_decision: Database["public"]["Enums"]["approval_status"]
          target_organization_id: string
        }
        Returns: {
          approval_action: string
          approval_entity_id: string
          approval_id: string
          approval_payload: Json
          resolved_status: Database["public"]["Enums"]["approval_status"]
        }[]
      }
      review_ai_message_draft: {
        Args: {
          target_decision: Database["public"]["Enums"]["message_draft_review_decision"]
          target_message_draft_id: string
          target_note?: string
          target_organization_id: string
        }
        Returns: {
          ai_run_id: string
          content_sha256: string
          decision: Database["public"]["Enums"]["message_draft_review_decision"]
          draft_updated_at: string
          id: string
          message_draft_id: string
          note: string | null
          organization_id: string
          reviewed_at: string
          reviewed_by: string
        }[]
        SetofOptions: {
          from: "*"
          to: "message_draft_reviews"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      review_knowledge_conflict: {
        Args: {
          target_conflict_id: string
          target_organization_id: string
          target_resolution_note: string
          target_status: Database["public"]["Enums"]["knowledge_conflict_status"]
        }
        Returns: {
          detected_at: string
          detection_reason: string
          id: string
          left_section_id: string
          organization_id: string
          resolution_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          right_section_id: string
          signal: Json
          status: Database["public"]["Enums"]["knowledge_conflict_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_conflicts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      revoke_quote_share: {
        Args: {
          target_note: string
          target_organization_id: string
          target_share_link_id: string
        }
        Returns: {
          revoked_at: string
          share_link_id: string
          share_status: string
        }[]
      }
      revoke_traveler_portal: {
        Args: {
          target_note: string
          target_organization_id: string
          target_portal_link_id: string
        }
        Returns: {
          approval_request_id: string
          approved_by: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          organization_id: string
          revocation_note: string | null
          revoked_at: string | null
          revoked_by: string | null
          snapshot: Json
          status: string
          token_hash: string
          trip_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trip_portal_links"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      scan_knowledge_conflicts: {
        Args: { target_organization_id: string }
        Returns: {
          detected_at: string
          detection_reason: string
          id: string
          left_section_id: string
          organization_id: string
          resolution_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          right_section_id: string
          signal: Json
          status: Database["public"]["Enums"]["knowledge_conflict_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_conflicts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_approved_knowledge: {
        Args: {
          target_limit?: number
          target_organization_id: string
          target_query: string
        }
        Returns: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          citation_label: string
          excerpt: string
          heading: string
          is_stale: boolean
          relevance: number
          review_due_on: string
          section_id: string
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source_id: string
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_title: string
          source_url: string
          version_label: string
        }[]
      }
      set_deal_qualification_check: {
        Args: {
          target_check_id: string
          target_is_complete: boolean
          target_organization_id: string
        }
        Returns: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          deal_id: string
          guidance: string | null
          id: string
          is_complete: boolean
          is_required: boolean
          label: string
          organization_id: string
          template_item_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "deal_qualification_checks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_operational_exception_status: {
        Args: {
          target_exception_id: string
          target_note?: string
          target_organization_id: string
          target_status: string
        }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          assigned_to: string | null
          created_at: string
          dedupe_key: string
          detected_at: string
          detected_by: string
          due_at: string | null
          evidence: Json
          exception_type: string
          id: string
          last_seen_at: string
          operator_note: string | null
          organization_id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_entity_id: string
          source_entity_type: string
          status: string
          summary: string
          title: string
          trip_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "operational_exceptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_quote_catalog_product_status: {
        Args: {
          target_organization_id: string
          target_product_id: string
          target_reason: string
          target_status: string
        }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          category: string
          created_at: string
          created_by: string
          currency: string
          description: string
          id: string
          name: string
          organization_id: string
          status: string
          supplier_id: string | null
          unit_label: string
        }[]
        SetofOptions: {
          from: "*"
          to: "quote_catalog_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      settle_ai_job: {
        Args: {
          target_error_code: string
          target_job_id: string
          target_retry_delay_seconds: number
          target_succeeded: boolean
          target_worker_id: string
        }
        Returns: {
          job_attempts: number
          job_available_at: string
          job_id: string
          job_status: Database["public"]["Enums"]["ai_job_status"]
        }[]
      }
      settle_analytics_report_run: {
        Args: {
          target_error_code?: string
          target_report_csv?: string
          target_report_filename?: string
          target_report_row_count?: number
          target_report_sha256?: string
          target_run_id: string
          target_status: string
          target_worker_id: string
        }
        Returns: {
          created_at: string
          error_code: string | null
          finished_at: string | null
          id: string
          organization_id: string
          report_csv: string | null
          report_filename: string | null
          report_row_count: number | null
          report_sha256: string | null
          schedule_snapshot: Json
          scheduled_for: string
          started_at: string
          status: string
          trigger_type: string
          worker_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "analytics_report_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      settle_operations_radar_run: {
        Args: {
          target_active_count?: number
          target_critical_count?: number
          target_error_code?: string
          target_resolved_count?: number
          target_run_id: string
          target_status: string
          target_worker_id: string
        }
        Returns: {
          active_count: number | null
          created_at: string
          critical_count: number | null
          error_code: string | null
          finished_at: string | null
          id: string
          organization_id: string
          policy_snapshot: Json
          resolved_count: number | null
          scheduled_for: string
          started_at: string
          status: string
          trigger_type: string
          worker_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "operations_radar_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      shares_active_organization: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      transition_booking_status: {
        Args: {
          target_booking_id: string
          target_confirmation_reference?: string
          target_organization_id: string
          target_status: Database["public"]["Enums"]["booking_status"]
          target_trip_id: string
        }
        Returns: {
          booking_type: string
          confirmation_reference: string | null
          confirmed_at: string | null
          cost_amount: number | null
          created_at: string
          currency: string
          details: Json
          id: string
          organization_id: string
          service_end_at: string | null
          service_start_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          supplier_id: string | null
          title: string
          trip_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      transition_deal_stage: {
        Args: {
          target_deal_id: string
          target_lost_reason?: string
          target_organization_id: string
          target_stage: Database["public"]["Enums"]["deal_stage"]
        }
        Returns: {
          archived_at: string | null
          contact_id: string | null
          created_at: string
          currency: string
          destination: string | null
          expected_close_at: string | null
          first_responded_at: string | null
          first_response_due_at: string | null
          follow_up_due_at: string | null
          id: string
          last_activity_at: string | null
          lost_at: string | null
          lost_reason: string | null
          next_step: string | null
          notes: string | null
          organization_id: string
          owner_id: string | null
          probability: number
          qualified_at: string | null
          sla_escalated_at: string | null
          sla_escalation_level: number
          source: string | null
          source_campaign: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at: string
          title: string
          travel_end: string | null
          travel_start: string | null
          traveller_count: number | null
          updated_at: string
          value_amount: number | null
          won_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "deals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      transition_knowledge_source: {
        Args: {
          target_organization_id: string
          target_source_id: string
          target_status: Database["public"]["Enums"]["knowledge_source_status"]
        }
        Returns: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          created_at: string
          created_by: string
          id: string
          ingested_byte_size: number | null
          ingested_file_name: string | null
          ingested_file_sha256: string | null
          ingestion_method: string
          organization_id: string
          retired_at: string | null
          review_due_on: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_source_status"]
          summary: string | null
          supersedes_source_id: string | null
          title: string
          updated_at: string
          valid_from: string | null
          version_label: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      transition_trip_status: {
        Args: {
          target_note?: string
          target_organization_id: string
          target_status: Database["public"]["Enums"]["trip_status"]
          target_trip_id: string
        }
        Returns: {
          converted_at: string | null
          converted_by: string | null
          created_at: string
          currency: string
          deal_id: string | null
          destination: string | null
          end_date: string | null
          id: string
          name: string
          operations_notes: string | null
          organization_id: string
          owner_id: string | null
          quote_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_knowledge_section: {
        Args: {
          target_citation_label: string
          target_content: string
          target_heading: string
          target_organization_id: string
          target_position: number
          target_section_id: string
          target_source_id: string
        }
        Returns: {
          citation_label: string
          content: string
          created_at: string
          created_by: string
          heading: string
          id: string
          organization_id: string
          position: number
          search_document: unknown
          source_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_analytics_report_schedule: {
        Args: {
          target_cadence: string
          target_forecast_horizon_days: number
          target_is_enabled: boolean
          target_next_run_at: string
          target_organization_id: string
          target_period_days: number
        }
        Returns: {
          cadence: string
          created_at: string
          forecast_horizon_days: number
          is_enabled: boolean
          last_delivery_at: string | null
          last_delivery_status: string | null
          next_run_at: string
          organization_id: string
          period_days: number
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analytics_report_schedules"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_analytics_target: {
        Args: {
          target_amount: number
          target_currency: string
          target_id?: string
          target_is_active: boolean
          target_label: string
          target_organization_id: string
          target_period_end: string
          target_period_start: string
        }
        Returns: {
          created_at: string
          created_by: string
          currency: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          period_end: string
          period_start: string
          target_amount: number
          updated_at: string
          updated_by: string
        }[]
        SetofOptions: {
          from: "*"
          to: "analytics_targets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_invoice_issuer_profile: {
        Args: {
          target_jurisdiction_country_code: string
          target_legal_name: string
          target_organization_id: string
          target_registered_address: string
          target_tax_registration_id?: string
        }
        Returns: {
          jurisdiction_country_code: string
          legal_name: string
          organization_id: string
          registered_address: string
          tax_registration_id: string | null
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "invoice_issuer_profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_invoice_number_policy: {
        Args: {
          target_next_number: number
          target_number_padding: number
          target_number_prefix: string
          target_organization_id: string
        }
        Returns: {
          next_number: number
          number_padding: number
          number_prefix: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "invoice_number_policies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_knowledge_source: {
        Args: {
          target_authority: Database["public"]["Enums"]["knowledge_authority"]
          target_organization_id: string
          target_review_due_on?: string
          target_sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          target_source_id?: string
          target_source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          target_source_url?: string
          target_summary?: string
          target_title: string
          target_valid_from?: string
          target_version_label?: string
        }
        Returns: {
          authority: Database["public"]["Enums"]["knowledge_authority"]
          created_at: string
          created_by: string
          id: string
          ingested_byte_size: number | null
          ingested_file_name: string | null
          ingested_file_sha256: string | null
          ingestion_method: string
          organization_id: string
          retired_at: string | null
          review_due_on: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source_kind: Database["public"]["Enums"]["knowledge_source_kind"]
          source_url: string | null
          status: Database["public"]["Enums"]["knowledge_source_status"]
          summary: string | null
          supersedes_source_id: string | null
          title: string
          updated_at: string
          valid_from: string | null
          version_label: string
        }[]
        SetofOptions: {
          from: "*"
          to: "knowledge_sources"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_operations_radar_policy: {
        Args: {
          target_confirmation_critical_hours: number
          target_confirmation_high_days: number
          target_confirmation_watch_days: number
          target_default_assignee_id?: string
          target_document_expiry_days: number
          target_document_high_days: number
          target_is_enabled: boolean
          target_organization_id: string
          target_payment_due_days: number
          target_payment_high_days: number
          target_scan_interval_minutes: number
          target_task_critical_hours: number
        }
        Returns: {
          confirmation_critical_hours: number
          confirmation_high_days: number
          confirmation_watch_days: number
          created_at: string
          default_assignee_id: string | null
          document_expiry_days: number
          document_high_days: number
          is_enabled: boolean
          last_run_at: string | null
          last_run_status: string | null
          next_run_at: string
          organization_id: string
          payment_due_days: number
          payment_high_days: number
          scan_interval_minutes: number
          task_critical_hours: number
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "operations_radar_policies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_quote_approval_policy: {
        Args: {
          target_commission_basis: string
          target_commission_percent: number
          target_enforce_standard_terms: boolean
          target_maximum_discount_percent: number
          target_maximum_validity_days: number
          target_minimum_margin_percent: number
          target_minimum_markup_percent: number
          target_minimum_post_commission_margin_percent: number
          target_organization_id: string
          target_require_cost_estimate: boolean
          target_require_valid_until: boolean
          target_standard_terms: Json
        }
        Returns: {
          commission_basis: string
          commission_percent: number
          created_at: string
          enforce_standard_terms: boolean
          maximum_discount_percent: number
          maximum_validity_days: number
          minimum_margin_percent: number
          minimum_markup_percent: number
          minimum_post_commission_margin_percent: number
          organization_id: string
          require_cost_estimate: boolean
          require_valid_until: boolean
          standard_terms: Json
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "quote_approval_policies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_traveler_entry_check: {
        Args: {
          target_action_due_on?: string
          target_citizenship_country_code: string
          target_destination_country_code: string
          target_evidence_source_label?: string
          target_evidence_source_url?: string
          target_organization_id: string
          target_passport_expires_on?: string
          target_passport_issuing_country_code?: string
          target_passport_validity_months_required?: number
          target_traveler_id: string
          target_trip_id: string
          target_visa_requirement?: string
          target_visa_status?: string
          target_visa_valid_until?: string
        }
        Returns: {
          action_due_on: string | null
          citizenship_country_code: string
          created_at: string
          destination_country_code: string
          evidence_source_label: string | null
          evidence_source_url: string | null
          id: string
          organization_id: string
          passport_expires_on: string | null
          passport_issuing_country_code: string | null
          passport_validity_months_required: number
          reviewed_at: string
          reviewed_by: string | null
          traveler_id: string
          trip_id: string
          updated_at: string
          visa_requirement: string
          visa_status: string
          visa_valid_until: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "traveler_entry_checks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      void_payment_obligation: {
        Args: {
          target_organization_id: string
          target_payment_id: string
          target_reason: string
        }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string | null
          description: string | null
          direction: string
          due_at: string | null
          id: string
          invoice_issuance_id: string | null
          invoice_number: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          provider_reference: string | null
          quote_acceptance_id: string | null
          quote_id: string | null
          quote_payment_schedule_id: string | null
          quote_schedule_item_position: number | null
          quote_version_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          status_note: string | null
          supplier_id: string | null
          title: string
          trip_id: string | null
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      ai_autonomy_mode: "observe" | "assist" | "auto" | "approval_required"
      ai_field_review_decision: "accepted" | "rejected"
      ai_job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "dead_letter"
      ai_job_type:
        | "lead_intake"
        | "itinerary_draft"
        | "knowledge_answer"
        | "conversation_reply_draft"
      ai_run_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "blocked"
        | "cancelled"
      app_role:
        | "owner"
        | "admin"
        | "sales"
        | "trip_designer"
        | "operations"
        | "finance"
        | "agent"
        | "viewer"
      approval_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "expired"
      booking_status:
        | "draft"
        | "requested"
        | "confirmed"
        | "cancelled"
        | "failed"
      contact_channel_preference: "email" | "phone" | "whatsapp" | "none"
      contact_consent_status: "unknown" | "granted" | "withdrawn"
      conversation_channel:
        | "email"
        | "whatsapp"
        | "web_form"
        | "phone"
        | "manual"
      conversation_status: "inbox" | "open" | "pending" | "closed"
      deal_stage: "new" | "qualified" | "proposal" | "decision" | "won" | "lost"
      document_sensitivity: "normal" | "restricted"
      knowledge_authority: "official" | "supplier" | "internal" | "third_party"
      knowledge_conflict_status: "open" | "confirmed" | "dismissed" | "resolved"
      knowledge_source_kind:
        | "destination_guide"
        | "visa_advisory"
        | "supplier_terms"
        | "sop"
        | "policy"
        | "product_sheet"
        | "other"
      knowledge_source_status: "draft" | "in_review" | "approved" | "retired"
      membership_status: "active" | "invited" | "suspended"
      message_direction: "inbound" | "outbound" | "internal"
      message_draft_review_decision:
        | "approved"
        | "changes_requested"
        | "rejected"
      payment_status:
        | "pending"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "refunded"
        | "void"
      quote_status:
        | "draft"
        | "shared"
        | "accepted"
        | "rejected"
        | "expired"
        | "superseded"
      task_status: "open" | "in_progress" | "completed" | "cancelled"
      trip_status:
        | "draft"
        | "confirmed"
        | "in_travel"
        | "completed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_autonomy_mode: ["observe", "assist", "auto", "approval_required"],
      ai_field_review_decision: ["accepted", "rejected"],
      ai_job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "dead_letter",
      ],
      ai_job_type: [
        "lead_intake",
        "itinerary_draft",
        "knowledge_answer",
        "conversation_reply_draft",
      ],
      ai_run_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "blocked",
        "cancelled",
      ],
      app_role: [
        "owner",
        "admin",
        "sales",
        "trip_designer",
        "operations",
        "finance",
        "agent",
        "viewer",
      ],
      approval_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ],
      booking_status: [
        "draft",
        "requested",
        "confirmed",
        "cancelled",
        "failed",
      ],
      contact_channel_preference: ["email", "phone", "whatsapp", "none"],
      contact_consent_status: ["unknown", "granted", "withdrawn"],
      conversation_channel: [
        "email",
        "whatsapp",
        "web_form",
        "phone",
        "manual",
      ],
      conversation_status: ["inbox", "open", "pending", "closed"],
      deal_stage: ["new", "qualified", "proposal", "decision", "won", "lost"],
      document_sensitivity: ["normal", "restricted"],
      knowledge_authority: ["official", "supplier", "internal", "third_party"],
      knowledge_conflict_status: ["open", "confirmed", "dismissed", "resolved"],
      knowledge_source_kind: [
        "destination_guide",
        "visa_advisory",
        "supplier_terms",
        "sop",
        "policy",
        "product_sheet",
        "other",
      ],
      knowledge_source_status: ["draft", "in_review", "approved", "retired"],
      membership_status: ["active", "invited", "suspended"],
      message_direction: ["inbound", "outbound", "internal"],
      message_draft_review_decision: [
        "approved",
        "changes_requested",
        "rejected",
      ],
      payment_status: [
        "pending",
        "partially_paid",
        "paid",
        "overdue",
        "refunded",
        "void",
      ],
      quote_status: [
        "draft",
        "shared",
        "accepted",
        "rejected",
        "expired",
        "superseded",
      ],
      task_status: ["open", "in_progress", "completed", "cancelled"],
      trip_status: [
        "draft",
        "confirmed",
        "in_travel",
        "completed",
        "cancelled",
      ],
    },
  },
} as const
