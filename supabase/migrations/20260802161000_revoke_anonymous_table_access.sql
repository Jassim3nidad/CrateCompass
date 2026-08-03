begin;

revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.spotify_connections from anon;
revoke all privileges on table public.favorite_discoveries from anon;
revoke all privileges on table public.discovery_sessions from anon;
revoke all privileges on table public.discovery_results from anon;
revoke all privileges on table public.generated_playlists from anon;
revoke all privileges on table public.discography_conversations from anon;
revoke all privileges on table public.discography_messages from anon;

commit;
