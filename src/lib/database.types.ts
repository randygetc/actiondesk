export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      llm_usage: {
        Row: {
          cached_tokens: number;
          cost_usd: number;
          created_at: string;
          feature: Database["public"]["Enums"]["llm_feature"];
          id: string;
          input_tokens: number;
          latency_ms: number;
          model: string;
          outcome: Database["public"]["Enums"]["llm_outcome"];
          output_tokens: number;
          prompt_version: string | null;
          request_id: string | null;
          user_id: string;
        };
        Insert: {
          cached_tokens?: number;
          cost_usd?: number;
          created_at?: string;
          feature: Database["public"]["Enums"]["llm_feature"];
          id?: string;
          input_tokens?: number;
          latency_ms?: number;
          model: string;
          outcome: Database["public"]["Enums"]["llm_outcome"];
          output_tokens?: number;
          prompt_version?: string | null;
          request_id?: string | null;
          user_id?: string;
        };
        Update: {
          cached_tokens?: number;
          cost_usd?: number;
          created_at?: string;
          feature?: Database["public"]["Enums"]["llm_feature"];
          id?: string;
          input_tokens?: number;
          latency_ms?: number;
          model?: string;
          outcome?: Database["public"]["Enums"]["llm_outcome"];
          output_tokens?: number;
          prompt_version?: string | null;
          request_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "llm_usage_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          owner_id?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assignee_text: string | null;
          completed_at: string | null;
          created_at: string;
          due_at: string | null;
          id: string;
          notes: string | null;
          owner_id: string;
          priority: Database["public"]["Enums"]["task_priority"];
          project_id: string | null;
          recurrence: string | null;
          recurrence_tz: string | null;
          series_id: string | null;
          source: Database["public"]["Enums"]["task_source"];
          source_quote: string | null;
          status: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          assignee_text?: string | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          notes?: string | null;
          owner_id?: string;
          priority?: Database["public"]["Enums"]["task_priority"];
          project_id?: string | null;
          recurrence?: string | null;
          recurrence_tz?: string | null;
          series_id?: string | null;
          source?: Database["public"]["Enums"]["task_source"];
          source_quote?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          assignee_text?: string | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          notes?: string | null;
          owner_id?: string;
          priority?: Database["public"]["Enums"]["task_priority"];
          project_id?: string | null;
          recurrence?: string | null;
          recurrence_tz?: string | null;
          series_id?: string | null;
          source?: Database["public"]["Enums"]["task_source"];
          source_quote?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_id_owner_id_fkey";
            columns: ["project_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      complete_task: {
        Args: { p_next_due_at?: string; p_task_id: string };
        Returns: string;
      };
      llm_spend_today: { Args: { p_tz: string }; Returns: number };
      log_llm_usage: {
        Args: {
          p_cached_tokens: number;
          p_cost_usd: number;
          p_feature: Database["public"]["Enums"]["llm_feature"];
          p_input_tokens: number;
          p_latency_ms: number;
          p_model: string;
          p_outcome: Database["public"]["Enums"]["llm_outcome"];
          p_output_tokens: number;
          p_prompt_version?: string;
          p_request_id?: string;
        };
        Returns: string;
      };
    };
    Enums: {
      llm_feature: "extract" | "ask";
      llm_outcome: "ok" | "invalid_output" | "error" | "capped" | "aborted";
      task_priority: "low" | "normal" | "high" | "urgent";
      task_source: "manual" | "extraction" | "ask";
      task_status: "todo" | "doing" | "done";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      llm_feature: ["extract", "ask"],
      llm_outcome: ["ok", "invalid_output", "error", "capped", "aborted"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_source: ["manual", "extraction", "ask"],
      task_status: ["todo", "doing", "done"],
    },
  },
} as const;
