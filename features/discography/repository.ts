import "server-only";

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Conversation persistence for the discography explorer.
 *
 * One client only — the request-scoped one — so Row Level Security is the
 * authority on every read and write. There is no privileged path here and no
 * reason for one: everything in these two tables belongs to the listener who
 * created it.
 *
 * Retention is "keep everything" until Phase 9 owns deletion controls, which is
 * decision 3 of the Phase 8 scoping. There is deliberately no purge, no TTL and
 * no cap in this module. The roadmap records when that needs revisiting.
 */

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
}

export interface Conversation {
  readonly id: string;
  readonly artistName: string;
  readonly title: string;
  readonly messages: readonly ConversationMessage[];
}

/** The newest conversation for this artist, or null when there is none. */
export async function readLatestConversation(input: {
  readonly userId: string;
  readonly canonicalArtistId: string;
}): Promise<Conversation | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("discography_conversations")
    .select("id, artist_name, title")
    .eq("user_id", input.userId)
    .eq("canonical_artist_id", input.canonicalArtistId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const { data: messages } = await supabase
    .from("discography_messages")
    .select("id, role, content, created_at")
    .eq("user_id", input.userId)
    .eq("conversation_id", data.id)
    .order("created_at", { ascending: true });

  return {
    id: data.id,
    artistName: data.artist_name,
    title: data.title,
    messages: (messages ?? []).map((message) => ({
      id: message.id,
      role: message.role as "user" | "assistant",
      content: message.content,
      createdAt: message.created_at,
    })),
  };
}

export async function startConversation(input: {
  readonly userId: string;
  readonly canonicalArtistId: string;
  readonly artistName: string;
  readonly title: string;
}): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("discography_conversations")
    .insert({
      user_id: input.userId,
      canonical_artist_id: input.canonicalArtistId.slice(0, 255),
      artist_name: input.artistName.slice(0, 255),
      title: input.title.slice(0, 255),
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error({
      event: "discography.conversation_insert_failed",
      code: error?.code,
    });
    return null;
  }

  return data.id;
}

/**
 * Appends the question and the answer together.
 *
 * One call rather than two so a failure cannot leave a question recorded with
 * no answer beside it, which would read back as the product having ignored
 * someone.
 */
export async function appendExchange(input: {
  readonly userId: string;
  readonly conversationId: string;
  readonly question: string;
  readonly answer: string;
  readonly aiProvider: string;
  readonly aiModel: string;
}): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase.from("discography_messages").insert([
    {
      user_id: input.userId,
      conversation_id: input.conversationId,
      role: "user",
      content: input.question.slice(0, 12_000),
    },
    {
      user_id: input.userId,
      conversation_id: input.conversationId,
      role: "assistant",
      content: input.answer.slice(0, 12_000),
      // The table's check constraint ties these to the assistant role: an
      // assistant message without a provider is rejected, which is what keeps
      // "which model said this" answerable for every stored answer.
      ai_provider: input.aiProvider,
      ai_model: input.aiModel.slice(0, 255),
    },
  ]);

  if (error) {
    logger.error({
      event: "discography.message_insert_failed",
      code: error.code,
    });
    return false;
  }

  // Touches updated_at so the newest conversation for an artist is the one
  // that was last spoken to, not the one created most recently.
  await supabase
    .from("discography_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("id", input.conversationId);

  return true;
}
