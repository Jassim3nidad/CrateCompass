import { z } from "zod";

/**
 * Validated shapes for every AI output.
 *
 * Two things these schemas are not:
 *
 * 1. **Not Spotify audio features.** `energyLevel`, `tempoPreference` and
 *    `valencePreference` are application-owned vocabulary with coarse buckets,
 *    deliberately unlike Spotify's numeric `energy` / `tempo` / `valence`
 *    fields. Naming them after Spotify's would invite someone to populate them
 *    from a Spotify response, which the boundary forbids.
 * 2. **Not a guarantee from the provider.** The Anthropic SDK renders
 *    `z.enum([...])` into the request as a *description hint* rather than an
 *    enforced JSON Schema constraint, so a model can return an out-of-range
 *    value. These schemas are what actually enforces the contract, client-side,
 *    and a parse failure must fall back rather than propagate.
 */

const shortText = z.string().trim().min(1).max(120);
const boundedList = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.array(item).max(max);

export const energyLevelSchema = z.enum(["low", "medium", "high"]);
export const tempoPreferenceSchema = z.enum([
  "slow",
  "moderate",
  "fast",
  "any",
]);
export const valencePreferenceSchema = z.enum([
  "melancholy",
  "neutral",
  "uplifting",
  "any",
]);
export const instrumentalPreferenceSchema = z.enum([
  "instrumental",
  "vocal",
  "any",
]);
export const vocalPreferenceSchema = z.enum(["any", "female", "male", "mixed"]);
export const explicitContentPreferenceSchema = z.enum([
  "allow",
  "avoid",
  "any",
]);

/**
 * Structured discovery criteria parsed from the user's own words.
 *
 * `clarificationNeeded` exists so the model can decline to guess. A mood like
 * "something for tonight" carries no retrievable signal, and inventing criteria
 * would produce confidently wrong recommendations.
 */
export const moodCriteriaSchema = z.object({
  primaryMood: shortText,
  secondaryMoods: boundedList(shortText, 5),
  energyLevel: energyLevelSchema,
  tempoPreference: tempoPreferenceSchema,
  valencePreference: valencePreferenceSchema,
  genreHints: boundedList(shortText, 8),
  eraHints: boundedList(shortText, 4),
  languagePreferences: boundedList(shortText, 4),
  instrumentalPreference: instrumentalPreferenceSchema,
  vocalPreference: vocalPreferenceSchema,
  activity: shortText.nullable(),
  explicitContentPreference: explicitContentPreferenceSchema,
  avoidTerms: boundedList(shortText, 8),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: z.string().trim().max(300).nullable(),
});

export type MoodCriteria = z.infer<typeof moodCriteriaSchema>;

/**
 * An explanation of why two artists are related.
 *
 * `groundedIn` forces the model to name which supplied facts it used. An
 * explanation citing nothing is treated as unsupported and discarded — the
 * reference-completeness check the compliance plan requires.
 */
export const artistMatchExplanationSchema = z.object({
  explanation: z.string().trim().min(1).max(1200),
  groundedIn: boundedList(shortText, 10).min(1),
  confidence: z.enum(["low", "medium", "high"]),
});

export type ArtistMatchExplanation = z.infer<
  typeof artistMatchExplanationSchema
>;

/**
 * A discography answer built only from retrieved MusicBrainz context.
 *
 * `sufficientContext: false` is a first-class success, not a failure: the honest
 * "I was not given enough to answer that" state the product promises instead of
 * a fabricated release date.
 */
export const discographyAnswerSchema = z.object({
  sufficientContext: z.boolean(),
  answer: z.string().trim().max(2000),
  citedReleaseIds: boundedList(z.string().trim().min(1).max(64), 20),
  unansweredReason: z.string().trim().max(300).nullable(),
});

export type DiscographyAnswer = z.infer<typeof discographyAnswerSchema>;

export const playlistTitleSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export const playlistDescriptionSchema = z.object({
  description: z.string().trim().min(1).max(280),
});

export type PlaylistTitle = z.infer<typeof playlistTitleSchema>;
export type PlaylistDescription = z.infer<typeof playlistDescriptionSchema>;

/**
 * Strict input schemas — the allowlist half of the gateway.
 *
 * Every one is `.strict()`: an unknown key is a rejection, not a silent strip.
 * That is what makes "a Spotify field cannot travel" true by construction
 * rather than by the recursive scan happening to recognise it.
 *
 * Prompt-bearing fields are length-capped here so an oversized input is
 * refused before it reaches a provider and bills tokens.
 */

export const MAX_USER_TEXT_LENGTH = 2000;

const userText = z.string().trim().min(1).max(MAX_USER_TEXT_LENGTH);
const artistName = z.string().trim().min(1).max(200);

export const parseMoodInputSchema = z.object({ moodText: userText }).strict();

export const evidenceFactSchema = z
  .object({
    // Only sources whose terms permit AI processing. Spotify is unrepresentable.
    source: z.enum(["musicbrainz", "listenbrainz"]),
    statement: z.string().trim().min(1).max(400),
  })
  .strict();

export const explainArtistMatchInputSchema = z
  .object({
    seedArtistName: artistName,
    candidateArtistName: artistName,
    evidence: z.array(evidenceFactSchema).min(1).max(12),
  })
  .strict();

export const answerDiscographyQuestionInputSchema = z
  .object({
    question: userText,
    artistName,
    releases: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(64),
            title: z.string().trim().min(1).max(300),
            primaryType: z.string().trim().max(40).nullable(),
            firstReleaseDate: z.string().trim().max(10).nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const generatePlaylistTextInputSchema = z
  .object({
    moodText: userText,
    criteria: moodCriteriaSchema,
  })
  .strict();
