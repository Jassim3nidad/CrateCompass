# Re-authorization copy

Status: **signed off, 2026-08-06**  
Date: 2026-08-05  
Implemented in: `features/spotify/reauthorization-copy.ts` (single source; the
interface renders these strings verbatim)

## The situation this copy has to handle

Adding `playlist-modify-public` invalidates the scope set every existing
connection was granted under. Those listeners did nothing wrong and nothing is
broken, but they will be asked to reconnect before they can create a playlist.

The failure mode to avoid is a screen that reads like an error. A listener who
believes something broke will assume the product is unreliable; a listener who
understands they are being asked for one additional permission will grant it or
decline it on the merits.

Three rules the wording follows:

1. **Name the cause, not the symptom.** "Missing permission" describes the
   database. "We added the ability to make playlists public" describes what
   actually happened.
2. **State what changes and what does not.** Nothing they have saved is
   affected; playlists already in Spotify stay there.
3. **Make declining a real option.** A listener who only ever wants private
   playlists should be told the honest cost of reconnecting: nothing, except
   the permission itself.

## The copy

### Connections page — existing connection missing the new scope

> **Reconnect to finish setting up playlists**
>
> CrateCompass can now create public playlists as well as private ones, which
> needs one additional permission from Spotify. Your connection was set up
> before that change, so Spotify has not been asked for it yet.
>
> Nothing is broken and nothing you have saved is affected. Playlists already
> in your Spotify account stay exactly as they are. Reconnecting takes you to
> Spotify to approve the same connection with the extra permission.
>
> [Reconnect Spotify]
>
> Prefer to keep it as it is? Discovery, explanations and your library all keep
> working. Only playlist creation needs the reconnect.

### Mood flow — blocked at playlist creation

> **This playlist needs a reconnect first**
>
> Creating a playlist needs a Spotify permission your connection does not have
> yet, because CrateCompass added public playlists after you connected.
>
> Your draft is kept. Reconnect, and you will come straight back to it.
>
> [Reconnect Spotify] [Keep editing]

### Callback outcome — permission declined at Spotify

> **Spotify did not grant the playlist permission**
>
> No connection was changed, and your existing one still works for everything
> except creating playlists. You can try again whenever you like.

### Connections page — visibility explanation, once connected

> CrateCompass can create private and public playlists in this Spotify account,
> and only when you explicitly approve one. New playlists are private unless
> you choose otherwise.

## What is deliberately absent

- No "action required", no warning triangle, no red. This is not a fault.
- No countdown, no "your connection will stop working". It has not stopped.
- No claim that the permission is required to use CrateCompass. It is required
  for one feature.

## Resolved: the draft-survival promise

The mood-flow variant promises the draft survives a reconnect round trip. When
this was written that was a commitment the copy made on the implementation's
behalf, and the implementation did not honour it. Traced on 2026-08-06, it
failed at three points:

1. `connectSpotify` hardcoded `redirectPath` to `/settings/connections`, so the
   listener never came back to the mood page at all.
2. The reconnect-required branch rendered a "Manage connections" link. The
   `[Reconnect Spotify] [Keep editing]` controls this document describes did not
   exist.
3. `MoodWorkflow` took no props and initialised every state slot to empty, so
   even arriving at `/mood` produced a blank workflow. The draft row survived;
   nothing pointed back at it.

Rather than downgrade the wording, the gap was closed: authorization now carries
a sanitised return path, the page rehydrates from the draft row, and both
controls exist. The sentence is accurate as written and needs no change.

Two settings — requested length and explicit-content preference — are carried in
the return path rather than read from the row, because `generated_playlists`
does not store them and defaulting them would silently reverse a listener's
choice. See `features/mood/resume.ts`. Resuming a draft outside this round trip
would want columns instead; that is a tracked follow-up, not a promise this copy
makes.
