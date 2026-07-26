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
      deals: {
        Row: {
          archived_at: string | null
          contact_id: string | null
          created_at: string
          currency: string
          destination: string | null
          expected_close_at: string | null
          id: string
          last_activity_at: string | null
          lost_reason: string | null
          next_step: string | null
          notes: string | null
          organization_id: string
          owner_id: string | null
          probability: number
          qualified_at: string | null
          source: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          title: string
          travel_end: string | null
          travel_start: string | null
          traveller_count: number | null
          updated_at: string
          value_amount: number | null
        }
        Insert: {
          archived_at?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          destination?: string | null
          expected_close_at?: string | null
          id?: string
          last_activity_at?: string | null
          lost_reason?: string | null
          next_step?: string | null
          notes?: string | null
          organization_id: string
          owner_id?: string | null
          probability?: number
          qualified_at?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title: string
          travel_end?: string | null
          travel_start?: string | null
          traveller_count?: number | null
          updated_at?: string
          value_amount?: number | null
        }
        Update: {
          archived_at?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          destination?: string | null
          expected_close_at?: string | null
          id?: string
          last_activity_at?: string | null
          lost_reason?: string | null
          next_step?: string | null
          notes?: string | null
          organization_id?: string
          owner_id?: string | null
          probability?: number
          qualified_at?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title?: string
          travel_end?: string | null
          travel_start?: string | null
          traveller_count?: number | null
          updated_at?: string
          value_amount?: number | null
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
      message_drafts: {
        Row: {
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
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deal_id: string | null
          direction: string
          due_at: string | null
          id: string
          organization_id: string
          paid_at: string | null
          provider_reference: string | null
          status: Database["public"]["Enums"]["payment_status"]
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          deal_id?: string | null
          direction: string
          due_at?: string | null
          id?: string
          organization_id: string
          paid_at?: string | null
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string | null
          direction?: string
          due_at?: string | null
          id?: string
          organization_id?: string
          paid_at?: string | null
          provider_reference?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_deal_same_organization_fkey"
            columns: ["organization_id", "deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
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
            foreignKeyName: "payments_trip_same_organization_fkey"
            columns: ["organization_id", "trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["organization_id", "id"]
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
      quote_versions: {
        Row: {
          cost_lines: Json
          created_at: string
          created_by: string | null
          id: string
          itinerary_snapshot: Json
          margin_amount: number | null
          margin_percent: number | null
          organization_id: string
          quote_id: string
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
          organization_id: string
          quote_id: string
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
          organization_id?: string
          quote_id?: string
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
      suppliers: {
        Row: {
          archived_at: string | null
          category: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          status: string
          terms: Json
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          status?: string
          terms?: Json
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          status?: string
          terms?: Json
          updated_at?: string
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
      trips: {
        Row: {
          created_at: string
          currency: string
          deal_id: string | null
          end_date: string | null
          id: string
          name: string
          organization_id: string
          owner_id: string | null
          quote_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          deal_id?: string | null
          end_date?: string | null
          id?: string
          name: string
          organization_id: string
          owner_id?: string | null
          quote_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          deal_id?: string | null
          end_date?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_id?: string | null
          quote_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Relationships: [
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
      create_itinerary_template_from_trip: {
        Args: {
          source_trip_id: string
          target_organization_id: string
          template_description?: string
          template_name: string
        }
        Returns: string
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
      has_organization_role: {
        Args: {
          permitted_roles: Database["public"]["Enums"]["app_role"][]
          target_organization_id: string
        }
        Returns: boolean
      }
      is_active_member: {
        Args: { target_organization_id: string }
        Returns: boolean
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
      shares_active_organization: {
        Args: { target_user_id: string }
        Returns: boolean
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
      ai_job_type: "lead_intake" | "itinerary_draft"
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
      membership_status: "active" | "invited" | "suspended"
      message_direction: "inbound" | "outbound" | "internal"
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
      ai_job_type: ["lead_intake", "itinerary_draft"],
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
      membership_status: ["active", "invited", "suspended"],
      message_direction: ["inbound", "outbound", "internal"],
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
