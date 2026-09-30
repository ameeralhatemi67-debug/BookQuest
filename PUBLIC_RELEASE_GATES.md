# BookQuest public release gates

The current release is a small invitation-only alpha. These checks define the work required before opening signup publicly.

- Enable verified email ownership and configure/test a production SMTP provider, including recovery and invitation redirects on different devices.
- Review authorization on hosted Supabase: anonymous/nonmember access, private room isolation, disabled accounts, early note and soundtrack access, moderation and revocation. Decide whether signed-URL expiry is sufficient for the expected privacy promise.
- Exercise physical iOS Safari and Android Chrome, keyboard/screen-reader navigation, long-press selection, PDF zoom, microphone denial, unsupported codecs and reduced motion.
- Set per-user storage/usage quotas, abuse limits, cleanup for abandoned drafts and retention/deletion rules. The current 100-track room cap and file ceilings do not replace account quotas.
- Separate Preview and Production databases. Verify backup/restore and migration rollback/recovery procedures; use additive migrations.
- Monitor auth, upload, Realtime and client failures with actionable alerts. Verify notification volume with a larger group and poor connections.
- Decide the book-sharing rights policy, reporting/moderation process, privacy terms and handling of personal information before public distribution.
- Run a complete hosted acceptance pass, including large TUS uploads within the effective service ceiling, expired tokens and disabled/deleted books. Record exact devices and browsers.
- Define the offline promise. The alpha supports interrupted sessions; a complete offline app needs its own cache lifecycle, revocation and synchronization design.

Use friend feedback to prioritize product changes. Native apps, public social feeds, licensed catalogs and a recommendation system remain outside this alpha.
