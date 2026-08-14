# Terms of service — DRAFT

> **Status: draft, not published, not legally reviewed.**
>
> Written by engineering to describe what the software actually does and what it
> genuinely cannot promise. Fill the placeholders and have it reviewed before
> publishing.

**Placeholders:** `[OPERATOR NAME]`, `[CONTACT EMAIL]`, `[JURISDICTION]`,
`[EFFECTIVE DATE]`.

---

## 1. What this is

CrateCompass helps you find artists, understand why they might be related,
translate a mood into a listening direction, explore discographies, and keep
what you find. Operated by `[OPERATOR NAME]`.

It is **not** a streaming service. It plays no audio and hosts no music.

## 2. Using it

You need an account. You are responsible for your credentials, and for the
accuracy of the email address you register.

You may not: access another person's account; attempt to defeat the access
controls or rate limits; use the service to violate a third-party provider's
terms; or automate it in a way that places disproportionate load on the upstream
providers this service depends on.

Reasonable per-account limits apply to AI-assisted features and may change.

## 3. Your Spotify account

Connecting Spotify is optional and everything except playlist creation works
without it.

If you connect, you authorise us to create playlists and add tracks **that you
have explicitly approved**, and nothing else. We request only the two
playlist-modify permissions; we cannot read your listening history, top artists,
saved music, or playback.

Playlists we create belong to you and live in your Spotify account. Disconnecting
or deleting your CrateCompass account does **not** delete them.

Your use of Spotify remains governed by Spotify's own terms. Spotify is a
registered trademark of Spotify AB. This service is not affiliated with,
endorsed by, or sponsored by Spotify.

## 4. Third-party data

Artist and release information comes from MusicBrainz, similarity data from
ListenBrainz. Both are community-maintained and credited in the interface beside
the data they supply, under their respective licences.

**We do not warrant that third-party data is accurate or complete.** Community
databases contain errors and gaps. Where our data is incomplete, the interface
says so rather than filling the gap.

## 5. AI-assisted features

Some features use a large language model to interpret your words and explain
evidence.

You should understand:

- AI output is **interpretation, not fact**. Explanations are a reading of
  evidence that providers supplied, not independent knowledge.
- We verify that answers cite only records actually retrieved, and we discard
  output that fails that check. That reduces fabrication; it does not eliminate
  every error.
- When the available data does not support an answer, the service says so. That
  is the intended behaviour, not a malfunction.
- Text you write is sent to the configured AI provider. **Data obtained from
  Spotify is never sent to any AI provider.**

Do not rely on AI output for any decision of consequence.

## 6. Your content

Notes, tags, mood descriptions and questions remain yours. You grant us only the
licence needed to store and display them back to you. We do not use them to
train AI models. Deleting them deletes them.

## 7. Availability

Provided **as is**, with no uptime guarantee. This is a small project depending
on several free third-party services, any of which may change, rate-limit, or
disappear. Features may degrade or become unavailable accordingly.

We may modify or discontinue the service. We will give reasonable notice where
we can.

## 8. Ending it

Delete your account at any time in Settings. It is immediate and removes your
data.

We may suspend an account that breaches these terms, or where required by a
provider or by law.

## 9. Liability

To the fullest extent permitted by law, `[OPERATOR NAME]` is not liable for
indirect or consequential loss, for loss of data, or for the accuracy of
third-party or AI-generated content. Nothing here excludes liability that cannot
lawfully be excluded.

## 10. Changes and governing law

Material changes will be announced in the application before taking effect.
Governed by the laws of `[JURISDICTION]`.

Questions: `[CONTACT EMAIL]`.

**Effective `[EFFECTIVE DATE]`.**

---

## Notes for review — remove before publishing

1. Section 5 is the one worth a careful read. It is deliberately explicit that
   AI output is interpretation, because the product's honesty claim is the
   thing a user would reasonably rely on.
2. Section 3 must be checked against current Spotify developer terms, which
   impose obligations on what an application may tell users.
3. Confirm the liability language is enforceable in `[JURISDICTION]`; consumer
   protection law may override parts of section 9.
4. Publish alongside the privacy policy and link both from the footer, which
   currently points "Privacy" at the settings page.
