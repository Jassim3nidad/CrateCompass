export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      discography_conversations: {
        Row: {
          artist_name: string;
          canonical_artist_id: string;
          created_at: string;
          id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          artist_name: string;
          canonical_artist_id: string;
          created_at?: string;
          id?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          artist_name?: string;
          canonical_artist_id?: string;
          created_at?: string;
          id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      discography_messages: {
        Row: {
          ai_model: string | null;
          ai_provider: string | null;
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          ai_model?: string | null;
          ai_provider?: string | null;
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          role: string;
          user_id: string;
        };
        Update: {
          ai_model?: string | null;
          ai_provider?: string | null;
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "discography_messages_conversation_id_user_id_fkey";
            columns: ["conversation_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "discography_conversations";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      discovery_results: {
        Row: {
          artist_name: string;
          canonical_artist_id: string | null;
          canonical_recording_id: string | null;
          created_at: string;
          id: string;
          rank: number;
          rationale: string;
          recording_name: string | null;
          session_id: string;
          source_provider: string;
          source_reference: string | null;
          user_id: string;
        };
        Insert: {
          artist_name: string;
          canonical_artist_id?: string | null;
          canonical_recording_id?: string | null;
          created_at?: string;
          id?: string;
          rank: number;
          rationale: string;
          recording_name?: string | null;
          session_id: string;
          source_provider: string;
          source_reference?: string | null;
          user_id: string;
        };
        Update: {
          artist_name?: string;
          canonical_artist_id?: string | null;
          canonical_recording_id?: string | null;
          created_at?: string;
          id?: string;
          rank?: number;
          rationale?: string;
          recording_name?: string | null;
          session_id?: string;
          source_provider?: string;
          source_reference?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "discovery_results_session_id_user_id_fkey";
            columns: ["session_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "discovery_sessions";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      discovery_sessions: {
        Row: {
          completed_at: string | null;
          created_at: string;
          failure_code: string | null;
          id: string;
          input_kind: string;
          input_value: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          failure_code?: string | null;
          id?: string;
          input_kind: string;
          input_value: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          failure_code?: string | null;
          id?: string;
          input_kind?: string;
          input_value?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      dismissed_discoveries: {
        Row: {
          candidate_artist_mbid: string;
          candidate_name: string;
          created_at: string;
          id: string;
          seed_artist_mbid: string;
          user_id: string;
        };
        Insert: {
          candidate_artist_mbid: string;
          candidate_name: string;
          created_at?: string;
          id?: string;
          seed_artist_mbid: string;
          user_id: string;
        };
        Update: {
          candidate_artist_mbid?: string;
          candidate_name?: string;
          created_at?: string;
          id?: string;
          seed_artist_mbid?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      favorite_discoveries: {
        Row: {
          artist_name: string;
          canonical_artist_id: string | null;
          canonical_recording_id: string | null;
          created_at: string;
          id: string;
          note: string | null;
          recording_name: string | null;
          source_reference: string | null;
          source_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          artist_name: string;
          canonical_artist_id?: string | null;
          canonical_recording_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          recording_name?: string | null;
          source_reference?: string | null;
          source_type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          artist_name?: string;
          canonical_artist_id?: string | null;
          canonical_recording_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          recording_name?: string | null;
          source_reference?: string | null;
          source_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      generated_playlist_tracks: {
        Row: {
          artist_mbid: string;
          artist_name: string;
          created_at: string;
          id: string;
          playlist_id: string;
          position: number;
          recording_mbid: string;
          release_title: string | null;
          spotify_uri: string | null;
          status: string;
          track_title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          artist_mbid: string;
          artist_name: string;
          created_at?: string;
          id?: string;
          playlist_id: string;
          position: number;
          recording_mbid: string;
          release_title?: string | null;
          spotify_uri?: string | null;
          status?: string;
          track_title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          artist_mbid?: string;
          artist_name?: string;
          created_at?: string;
          id?: string;
          playlist_id?: string;
          position?: number;
          recording_mbid?: string;
          release_title?: string | null;
          spotify_uri?: string | null;
          status?: string;
          track_title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_playlist_tracks_playlist_id_user_id_fkey";
            columns: ["playlist_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "generated_playlists";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      generated_playlists: {
        Row: {
          created_at: string;
          description: string | null;
          discovery_session_id: string | null;
          failure_code: string | null;
          id: string;
          idempotency_key: string | null;
          is_public: boolean;
          mood_text: string | null;
          name: string;
          spotify_playlist_id: string | null;
          spotify_playlist_url: string | null;
          status: string;
          track_total: number;
          tracks_added: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          discovery_session_id?: string | null;
          failure_code?: string | null;
          id?: string;
          idempotency_key?: string | null;
          is_public?: boolean;
          mood_text?: string | null;
          name: string;
          spotify_playlist_id?: string | null;
          spotify_playlist_url?: string | null;
          status?: string;
          track_total?: number;
          tracks_added?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          discovery_session_id?: string | null;
          failure_code?: string | null;
          id?: string;
          idempotency_key?: string | null;
          is_public?: boolean;
          mood_text?: string | null;
          name?: string;
          spotify_playlist_id?: string | null;
          spotify_playlist_url?: string | null;
          status?: string;
          track_total?: number;
          tracks_added?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generated_playlists_discovery_session_id_user_id_fkey";
            columns: ["discovery_session_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "discovery_sessions";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          preferred_ai_provider: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          preferred_ai_provider?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          preferred_ai_provider?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      spotify_connections: {
        Row: {
          connected_at: string;
          disconnected_at: string | null;
          display_name: string | null;
          id: string;
          last_verified_at: string | null;
          scopes: string[];
          spotify_user_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connected_at?: string;
          disconnected_at?: string | null;
          display_name?: string | null;
          id?: string;
          last_verified_at?: string | null;
          scopes?: string[];
          spotify_user_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connected_at?: string;
          disconnected_at?: string | null;
          display_name?: string | null;
          id?: string;
          last_verified_at?: string | null;
          scopes?: string[];
          spotify_user_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      begin_spotify_oauth: {
        Args: {
          p_code_verifier_ciphertext: string;
          p_code_verifier_nonce: string;
          p_encryption_key_version: number;
          p_expires_at: string;
          p_redirect_path: string;
          p_state_digest: string;
          p_transaction_id: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      claim_ai_usage: {
        Args: {
          p_daily_limit: number;
          p_operation: string;
          p_per_minute_limit: number;
          p_provider: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      claim_idempotency_key: {
        Args: {
          p_idempotency_key: string;
          p_operation: string;
          p_request_digest: string;
          p_ttl_seconds?: number;
          p_user_id: string;
        };
        Returns: {
          claimed: boolean;
          conflict: boolean;
          response_body: Json;
        }[];
      };
      claim_spotify_connection: {
        Args: {
          p_connection_id: string;
          p_display_name: string;
          p_scopes: string[];
          p_spotify_user_id: string;
          p_user_id: string;
        };
        Returns: string;
      };
      complete_idempotency_key: {
        Args: {
          p_idempotency_key: string;
          p_operation: string;
          p_response_body: Json;
          p_response_status: number;
          p_user_id: string;
        };
        Returns: undefined;
      };
      consume_spotify_oauth: {
        Args: { p_state_digest: string };
        Returns: {
          code_verifier_ciphertext: string;
          code_verifier_nonce: string;
          encryption_key_version: number;
          redirect_path: string;
          transaction_id: string;
          user_id: string;
        }[];
      };
      disconnect_spotify: { Args: { p_user_id: string }; Returns: boolean };
      mark_spotify_connection_expired: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      purge_ai_usage_events: { Args: never; Returns: number };
      purge_expired_spotify_oauth_transactions: {
        Args: never;
        Returns: number;
      };
      read_spotify_credentials: {
        Args: { p_user_id: string };
        Returns: {
          access_token_ciphertext: string;
          access_token_nonce: string;
          connection_id: string;
          encryption_key_version: number;
          refresh_token_ciphertext: string;
          refresh_token_nonce: string;
          scopes: string[];
          spotify_user_id: string;
          status: string;
          token_expires_at: string;
        }[];
      };
      release_idempotency_key: {
        Args: {
          p_idempotency_key: string;
          p_operation: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      rotate_spotify_credentials: {
        Args: {
          p_access_token_ciphertext: string;
          p_access_token_nonce: string;
          p_connection_id: string;
          p_encryption_key_version: number;
          p_expected_token_expires_at: string;
          p_refresh_token_ciphertext: string;
          p_refresh_token_nonce: string;
          p_token_expires_at: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      store_spotify_credentials: {
        Args: {
          p_access_token_ciphertext: string;
          p_access_token_nonce: string;
          p_connection_id: string;
          p_encryption_key_version: number;
          p_refresh_token_ciphertext: string;
          p_refresh_token_nonce: string;
          p_token_expires_at: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
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
  public: {
    Enums: {},
  },
} as const;
