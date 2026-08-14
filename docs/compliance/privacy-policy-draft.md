# Privacy policy — DRAFT

> **Status: draft, not published, not legally reviewed.**
>
> This is engineering's accurate description of what the software actually does,
> written so a lawyer can turn it into a policy without first reverse-engineering
> the code. Every claim below was checked against the implementation. Do not
> publish it as-is: the placeholders must be filled and the whole reviewed.
>
> Publishing a privacy policy is a prerequisite for a Spotify application and
> blocks any pilot with real users (audit finding SPC-01).

**Placeholders:** `[CONTROLLER NAME]`, `[CONTACT EMAIL]`, `[JURISDICTION]`,
`[EFFECTIVE DATE]`.

---

## Who we are

CrateCompass is a music discovery service operated by `[CONTROLLER NAME]`.
Contact: `[CONTACT EMAIL]`.

## What we collect

### You give us

| Data | Why | Where |
| --- | --- | --- |
| Email address and password | Authentication | Supabase Auth |
| Display name | Shown in your account | `profiles` |
| Preferred AI provider | Your setting | `profiles` |
| Mood descriptions, questions, notes, tags | The features themselves | Feature tables |

Passwords are stored hashed by Supabase Auth. We never see them.

### Created as you use it

| Data | Why |
| --- | --- |
| Saved discoveries — MusicBrainz IDs, names, your notes and tags | Your library |
| The explanation that accompanied a save, as a versioned snapshot | So a kept discovery still explains itself later |
| Discovery history — what was asked, which provider answered, the outcome, when | Your history page |
| Discography conversations | So you can revisit answers |
| AI usage counts — timestamp, provider, operation | Enforcing daily and per-minute limits |

Usage records count requests. They do not store the content of your requests.

### If you connect Spotify

| Data | Why |
| --- | --- |
| Your Spotify account ID and display name | Linking the account |
| Granted scopes | Knowing what we may do |
| Access and refresh tokens, **encrypted at rest** | Acting on your approval |
| Playlist ID and URL of playlists we created for you | Recording what we made |
| Track URIs for those playlists | Creating and repairing them reliably |

We request only `playlist-modify-private` and `playlist-modify-public`. We
**cannot** read your listening history, top artists, saved music, or playback
state — those permissions are never requested.

We do not copy Spotify's catalogue, and we do not download or host Spotify
artwork.

## What we never do

- **We never send anything from Spotify to an AI provider.** Not metadata, not
  playlists, not images, not audio features. This is enforced in four
  independent ways in the software, not merely promised.
- We do not use your data to train, fine-tune, or evaluate any AI model.
- We do not sell your data.
- We do not run advertising or third-party analytics.
- We do not track you across other sites.

## Who processes your data

| Processor | Role | Receives |
| --- | --- | --- |
| Supabase | Database, authentication, hosting | Everything above |
| Vercel | Application hosting | Request metadata and server logs |
| MusicBrainz | Artist and release data | Search terms and artist identifiers |
| ListenBrainz | Similar-artist data | Artist identifiers |
| `[AI PROVIDER]` | Mood interpretation, explanations, answers | Your written text, and MusicBrainz/ListenBrainz data. **Never Spotify data.** |
| Spotify | Links and playlist creation, only if you connect | Search terms and playlist contents you approved |

Some processors are outside `[JURISDICTION]`. `[TRANSFER MECHANISM]`.

## Cookies

Only what authentication needs — a session cookie set by Supabase Auth, and a
short-lived state cookie during the Spotify connection flow. No advertising or
analytics cookies, so there is no consent banner because there is nothing to
consent to.

## How long we keep it

| Data | Retention |
| --- | --- |
| Account and library | Until you delete it |
| History and conversations | Until you delete them, or the account |
| Spotify tokens | Until you disconnect, or delete the account |
| AI usage counts | Rolling window for limit enforcement |
| Server logs | Per Vercel's retention |

**Discovery history and conversations currently have no automatic expiry.** That
default was sized for a small pilot and is under review before any wider
release.

## Your rights

- **Access and portability.** We can produce a complete export of everything
  attached to your account. Request it at `[CONTACT EMAIL]`. *(Currently an
  operator-run procedure; there is no self-service download yet.)*
- **Deletion.** Settings → Delete account. Requires your password and a typed
  confirmation. It is immediate and cascades to every record. Playlists already
  created in your Spotify account are **not** deleted — they are yours.
- **Disconnect Spotify** at any time, independently, without deleting your
  account.
- **Correction, restriction, objection**, and complaint to `[SUPERVISORY
  AUTHORITY]`.

Deletion is genuine. There is no soft-delete flag and no holding table; a test
asserts that a deleted account returns nothing from the data export.

## Security

Row Level Security on every table, so a query cannot reach another listener's
rows. Spotify tokens encrypted with AES-256-GCM, cryptographically bound to the
account they belong to. Credentials never logged. Least-privilege database
access. HTTPS everywhere.

No system is perfectly secure, and we do not claim otherwise. Our current
open security findings are tracked internally and remediated in priority order.

## Children

Not directed at children under `[AGE]`. We do not knowingly collect their data.

## Changes

Material changes will be announced in the application before taking effect.

**Effective `[EFFECTIVE DATE]`.**

---

## Notes for review — remove before publishing

1. Fill every placeholder, especially the AI provider, which is configurable and
   must name whichever is deployed.
2. Confirm the transfer mechanism for processors outside `[JURISDICTION]`.
3. Settle the retention question for history and conversations. "No expiry" is a
   decision, and should be a deliberate one.
4. The export is documented but has no user-facing route. Either build it or
   describe the manual process honestly.
5. Cross-check against Spotify's developer terms for required disclosures.
