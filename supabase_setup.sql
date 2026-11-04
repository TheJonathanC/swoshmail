-- =============================================================================
-- Swosh Workspace database schema (Supabase / PostgreSQL 15+)
--
-- Paste the whole file into the Supabase SQL Editor and run it. It is idempotent:
-- safe on a fresh project AND re-runnable on an existing database (the MIGRATION
-- section upgrades older installs in place and is a no-op once applied).
--
-- Security model: the browser never talks to these tables. All access goes through
-- Next.js route handlers using the service-role key (which bypasses RLS) and every
-- query is scoped by the signed-in user's id in code. RLS is ENABLED with NO
-- policies for anon/authenticated, and table privileges are revoked, so the public
-- anon key cannot read or modify anything through PostgREST.
-- =============================================================================

BEGIN;

-- gen_random_uuid() is built into PostgreSQL 13+.

-- -----------------------------------------------------------------------------
-- 1. Base tables (fresh installs)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  storage_used  BIGINT NOT NULL DEFAULT 0,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  parent_id  UUID,
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  size         BIGINT NOT NULL,
  key          VARCHAR(512) NOT NULL,
  url          TEXT,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id    UUID,
  content_type TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject   TEXT NOT NULL,
  body      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending',
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id UUID NOT NULL REFERENCES email_logs(id) ON DELETE CASCADE,
  file_id      UUID REFERENCES files(id) ON DELETE SET NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_size    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  save_messages BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user1_id, user2_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  ephemeral       BOOLEAN NOT NULL DEFAULT false,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

-- Shared sliding-window rate limiter (see swosh_rate_limit below). One row per
-- accepted hit; rows older than the longest window are deleted lazily.
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key    TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. MIGRATION (upgrades existing databases; every step is idempotent)
-- =============================================================================

-- 2.1 users.storage_used ------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_used BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();
-- Server-authoritative chat presence: set by POST /api/chat/presence (heartbeat),
-- NULL when the user went offline. Clients cannot write presence themselves.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- 2.2 files columns -------------------------------------------------------------
ALTER TABLE files ADD COLUMN IF NOT EXISTS folder_id UUID;
ALTER TABLE files ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE files ALTER COLUMN url DROP NOT NULL;
ALTER TABLE files ALTER COLUMN uploaded_at SET DEFAULT now();
ALTER TABLE folders ALTER COLUMN created_at SET DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_size_nonnegative') THEN
    ALTER TABLE files ADD CONSTRAINT files_size_nonnegative CHECK (size >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS files_key_unique ON files(key);

-- 2.3 Composite ownership FKs ---------------------------------------------------
-- A file's folder (and a folder's parent) must belong to the same owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_id_owner_unique') THEN
    ALTER TABLE folders ADD CONSTRAINT folders_id_owner_unique UNIQUE (id, owner_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_id_owner_unique') THEN
    ALTER TABLE files ADD CONSTRAINT files_id_owner_unique UNIQUE (id, owner_id);
  END IF;
END $$;

-- Drop any legacy single-column FKs on files.folder_id / folders.parent_id.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND (
        (c.conrelid = 'public.files'::regclass
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.files'::regclass AND attname = 'folder_id')]::smallint[])
        OR
        (c.conrelid = 'public.folders'::regclass
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.folders'::regclass AND attname = 'parent_id')]::smallint[])
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- Repair rows that would violate the new FKs (cross-owner or dangling references).
UPDATE files f SET folder_id = NULL
WHERE f.folder_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders d WHERE d.id = f.folder_id AND d.owner_id = f.owner_id);
UPDATE folders f SET parent_id = NULL
WHERE f.parent_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = f.parent_id AND p.owner_id = f.owner_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'files_folder_owner_fkey') THEN
    ALTER TABLE files ADD CONSTRAINT files_folder_owner_fkey
      FOREIGN KEY (folder_id, owner_id) REFERENCES folders(id, owner_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'folders_parent_owner_fkey') THEN
    ALTER TABLE folders ADD CONSTRAINT folders_parent_owner_fkey
      FOREIGN KEY (parent_id, owner_id) REFERENCES folders(id, owner_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_shares_file_owner_fkey') THEN
    ALTER TABLE file_shares ADD CONSTRAINT file_shares_file_owner_fkey
      FOREIGN KEY (file_id, owner_id) REFERENCES files(id, owner_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2.4 email_logs ----------------------------------------------------------------
ALTER TABLE email_logs ALTER COLUMN subject TYPE TEXT;
ALTER TABLE email_logs ALTER COLUMN recipient TYPE TEXT;
-- Existing rows were only logged after a successful send.
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE email_logs ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE email_logs ALTER COLUMN sent_at SET DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_logs_status_check') THEN
    ALTER TABLE email_logs ADD CONSTRAINT email_logs_status_check CHECK (status IN ('pending', 'sent', 'failed'));
  END IF;
END $$;

-- 2.5 conversations -------------------------------------------------------------
UPDATE conversations SET save_messages = false WHERE save_messages IS NULL;
ALTER TABLE conversations ALTER COLUMN save_messages SET DEFAULT false;
ALTER TABLE conversations ALTER COLUMN save_messages SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN created_at SET DEFAULT now();
-- Normalize ordering (the app always stores the smaller id in user1_id).
UPDATE conversations SET user1_id = user2_id, user2_id = user1_id WHERE user1_id > user2_id;
DELETE FROM conversations WHERE user1_id = user2_id;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_ordered_users') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_ordered_users CHECK (user1_id < user2_id);
  END IF;
END $$;

-- 2.6 messages ------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'ephemeral') THEN
    ALTER TABLE messages ADD COLUMN ephemeral BOOLEAN NOT NULL DEFAULT false;
    -- Messages that exist in disappearing-mode conversations were sent as ephemeral.
    UPDATE messages m SET ephemeral = true
    FROM conversations c WHERE c.id = m.conversation_id AND c.save_messages = false;
  END IF;
END $$;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ALTER COLUMN created_at SET DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_length') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_content_length CHECK (char_length(content) <= 8000) NOT VALID;
  END IF;
END $$;

-- 2.7 file_shares ---------------------------------------------------------------
ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE file_shares ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- 2.8 Indexes -------------------------------------------------------------------
DROP INDEX IF EXISTS idx_messages_created_at;      -- never useful on its own
DROP INDEX IF EXISTS idx_messages_conversation;    -- superseded by the composite below
DROP INDEX IF EXISTS idx_files_owner;              -- superseded by idx_files_owner_folder
DROP INDEX IF EXISTS idx_files_folder;             -- superseded by idx_files_folder_owner
DROP INDEX IF EXISTS idx_folders_owner;            -- superseded by idx_folders_owner_parent
DROP INDEX IF EXISTS idx_email_logs_sender;        -- superseded by idx_email_logs_sender_sent
DROP INDEX IF EXISTS idx_email_logs_sent_at;

CREATE INDEX IF NOT EXISTS idx_files_owner_folder      ON files(owner_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_files_folder_owner      ON files(folder_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner_parent    ON folders(owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent          ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created   ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender         ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sender_sent  ON email_logs(sender_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_attachments_log   ON email_attachments(email_log_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_file  ON email_attachments(file_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user1     ON conversations(user1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user2     ON conversations(user2_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_file        ON file_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_owner       ON file_shares(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_shares_recipient   ON file_shares(recipient_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_key_hit ON rate_limit_hits(key, hit_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_hit_at  ON rate_limit_hits(hit_at);

-- =============================================================================
-- 3. Quota accounting (atomic)
--
-- users.storage_used is adjusted by a row trigger on files. The UPDATE takes a row
-- lock on the owner, so concurrent uploads serialize and cannot overshoot: an
-- insert/grow that would exceed 1 GiB raises SQLSTATE 23514 'quota_exceeded' and
-- the statement rolls back. Decreases are always allowed (an account that is over
-- quota from before this migration can still delete files).
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_storage_used_nonnegative') THEN
    ALTER TABLE users ADD CONSTRAINT users_storage_used_nonnegative CHECK (storage_used >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.swosh_files_storage_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  quota CONSTANT bigint := 1073741824; -- 1 GiB, keep in sync with src/lib/constants.ts
  new_total bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET storage_used = storage_used + NEW.size
      WHERE id = NEW.owner_id RETURNING storage_used INTO new_total;
    IF NEW.size > 0 AND new_total > quota THEN
      RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET storage_used = GREATEST(storage_used - OLD.size, 0) WHERE id = OLD.owner_id;
    RETURN OLD;
  ELSE
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      UPDATE users SET storage_used = GREATEST(storage_used - OLD.size, 0) WHERE id = OLD.owner_id;
      UPDATE users SET storage_used = storage_used + NEW.size
        WHERE id = NEW.owner_id RETURNING storage_used INTO new_total;
      IF NEW.size > 0 AND new_total > quota THEN
        RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.size IS DISTINCT FROM OLD.size THEN
      UPDATE users SET storage_used = GREATEST(storage_used + (NEW.size - OLD.size), 0)
        WHERE id = NEW.owner_id RETURNING storage_used INTO new_total;
      IF NEW.size > OLD.size AND new_total > quota THEN
        RAISE EXCEPTION 'quota_exceeded' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS swosh_files_storage ON files;
CREATE TRIGGER swosh_files_storage
  AFTER INSERT OR DELETE OR UPDATE OF size, owner_id ON files
  FOR EACH ROW EXECUTE FUNCTION public.swosh_files_storage_trg();

-- Backfill (re-running recomputes from the source of truth).
UPDATE users u SET storage_used = COALESCE(s.total, 0)
FROM (SELECT uu.id, (SELECT SUM(f.size) FROM files f WHERE f.owner_id = uu.id) AS total FROM users uu) s
WHERE s.id = u.id AND u.storage_used IS DISTINCT FROM COALESCE(s.total, 0);

-- =============================================================================
-- 4. Chat history pruning: keep at most 100 non-ephemeral messages per conversation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.swosh_prune_messages_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM messages
  WHERE id IN (
    SELECT id FROM messages
    WHERE conversation_id = NEW.conversation_id AND ephemeral = false
    ORDER BY created_at DESC, id DESC
    OFFSET 100
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS swosh_prune_messages ON messages;
CREATE TRIGGER swosh_prune_messages
  AFTER INSERT ON messages
  FOR EACH ROW WHEN (NEW.ephemeral = false)
  EXECUTE FUNCTION public.swosh_prune_messages_trg();

-- =============================================================================
-- 5. RPC functions (called by the server with the service role only)
-- =============================================================================

-- Ancestors of a folder, root first. Empty if the folder is not owned by p_owner_id.
CREATE OR REPLACE FUNCTION public.folder_breadcrumbs(p_folder_id uuid, p_owner_id uuid)
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain AS (
    SELECT f.id, f.name::text AS name, f.parent_id, 0 AS depth
    FROM folders f
    WHERE f.id = p_folder_id AND f.owner_id = p_owner_id
    UNION
    SELECT p.id, p.name::text, p.parent_id, c.depth + 1
    FROM folders p
    JOIN chain c ON p.id = c.parent_id
    WHERE p.owner_id = p_owner_id AND c.depth < 256
  )
  SELECT chain.id, chain.name FROM chain ORDER BY depth DESC;
$$;

-- The folder itself plus all descendant folders, and every file inside them.
-- Returns {"folders":[{id,name,parent_id}], "files":[{id,name,size,key,folder_id}]}
-- or NULL when the folder is not owned by p_owner_id.
CREATE OR REPLACE FUNCTION public.folder_tree_contents(p_folder_id uuid, p_owner_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE tree AS (
    SELECT f.id, f.name::text AS name, f.parent_id, 0 AS depth
    FROM folders f
    WHERE f.id = p_folder_id AND f.owner_id = p_owner_id
    UNION
    SELECT c.id, c.name::text, c.parent_id, t.depth + 1
    FROM folders c
    JOIN tree t ON c.parent_id = t.id
    WHERE c.owner_id = p_owner_id AND t.depth < 256
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM tree) THEN NULL ELSE jsonb_build_object(
    'folders', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'parent_id', t.parent_id) ORDER BY t.depth) FROM tree t), '[]'::jsonb),
    'files', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', fi.id, 'name', fi.name, 'size', fi.size, 'key', fi.key, 'folder_id', fi.folder_id))
      FROM files fi
      WHERE fi.owner_id = p_owner_id AND fi.folder_id IN (SELECT t.id FROM tree t)
    ), '[]'::jsonb)
  ) END;
$$;

-- Used by Realtime Authorization policies below (runs with definer rights so the
-- authenticated role does not need SELECT on conversations).
CREATE OR REPLACE FUNCTION public.swosh_is_participant(conv uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conv AND (c.user1_id = uid OR c.user2_id = uid)
  );
$$;

-- Shared sliding-window rate limiter used by src/lib/rate-limit.ts.
-- Serialises callers per key with a transaction-scoped advisory lock, drops this
-- key's hits that left the window, and records a hit only when allowed (denied
-- requests never extend the window). reset_ms = ms until the oldest hit in the
-- window expires. About 1% of calls also purge hits older than a day (all keys).
CREATE OR REPLACE FUNCTION public.swosh_rate_limit(p_key text, p_limit int, p_window_ms int)
RETURNS TABLE (allowed boolean, remaining int, reset_ms bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window interval;
  v_now    timestamptz;
  v_count  int;
  v_oldest timestamptz;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 512
     OR p_limit IS NULL OR p_limit < 1 OR p_window_ms IS NULL OR p_window_ms < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_window := make_interval(secs => p_window_ms / 1000.0);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));
  -- Read the clock after the lock so waiting callers see an up-to-date window.
  v_now := clock_timestamp();

  DELETE FROM rate_limit_hits h WHERE h.key = p_key AND h.hit_at <= v_now - v_window;
  SELECT count(*)::int, min(h.hit_at) INTO v_count, v_oldest FROM rate_limit_hits h WHERE h.key = p_key;

  IF v_count < p_limit THEN
    INSERT INTO rate_limit_hits (key, hit_at) VALUES (p_key, v_now);
    v_count := v_count + 1;
    v_oldest := COALESCE(v_oldest, v_now);
    allowed := true;
  ELSE
    allowed := false;
  END IF;
  remaining := GREATEST(p_limit - v_count, 0);
  reset_ms := GREATEST(0, ceil(extract(epoch FROM (v_oldest + v_window - v_now)) * 1000))::bigint;

  IF random() < 0.01 THEN
    DELETE FROM rate_limit_hits h WHERE h.hit_at < v_now - interval '1 day';
  END IF;

  RETURN NEXT;
END;
$$;

-- For every conversation p_user_id participates in: ids of the latest p_limit
-- (capped at 100) messages NOT sent by p_user_id, newest first (possibly empty).
-- One statement for all conversations; each array uses idx_messages_conv_created.
-- Powers unread badges while realtime is unavailable (polling fallback).
CREATE OR REPLACE FUNCTION public.swosh_recent_incoming(p_user_id uuid, p_limit int DEFAULT 20)
RETURNS TABLE (conversation_id uuid, ids uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id,
         ARRAY(
           SELECT m.id FROM messages m
           WHERE m.conversation_id = c.id AND m.sender_id <> p_user_id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
         )
  FROM conversations c
  WHERE c.user1_id = p_user_id OR c.user2_id = p_user_id;
$$;

-- =============================================================================
-- 6. Lock down the public schema
-- =============================================================================

ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE files             ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_shares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_hits   ENABLE ROW LEVEL SECURITY;

-- Remove any policies that may have been added by hand for anon/authenticated.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('users','folders','files','email_logs','email_attachments','conversations','messages','file_shares','rate_limit_hits')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.folder_breadcrumbs(uuid, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.folder_tree_contents(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.swosh_is_participant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swosh_rate_limit(text, int, int)  TO service_role;
GRANT EXECUTE ON FUNCTION public.swosh_recent_incoming(uuid, int)  TO service_role;

-- =============================================================================
-- 7. Realtime Authorization (private channels)
--
-- Clients connect with a short-lived JWT from /api/chat/realtime-token
-- (role "authenticated", sub = users.id) and may only:
--   * receive broadcasts on swoshchat:user:<own id>
--   * receive broadcasts on swoshchat:conv:<id> for conversations they are in
-- Nobody but the server (service role) can write to realtime.messages: there is no
-- INSERT policy, so clients can neither broadcast nor track presence. Presence is
-- server-authoritative (users.last_seen_at via POST /api/chat/presence, announced as
-- a "presence" broadcast on each partner's user channel).
-- ALSO REQUIRED: Dashboard -> Realtime -> Settings -> disable "Allow public access".
-- =============================================================================

-- RLS is already enabled on realtime.messages by Supabase (the table is owned by the
-- realtime admin role, so it is not altered here); we only add policies.

DROP POLICY IF EXISTS swosh_realtime_receive ON realtime.messages;
CREATE POLICY swosh_realtime_receive ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND CASE
      WHEN realtime.topic() = 'swoshchat:user:' || (SELECT auth.uid())::text THEN true
      WHEN realtime.topic() ~ '^swoshchat:conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        public.swosh_is_participant(substr(realtime.topic(), 16)::uuid, (SELECT auth.uid()))
      ELSE false
    END
  );

-- Client-side presence tracking was forgeable (anyone could claim any user_id): removed.
DROP POLICY IF EXISTS swosh_realtime_presence_track ON realtime.messages;

COMMIT;

-- -----------------------------------------------------------------------------
-- Creating users: `node scripts/hash-password.mjs <username> <password>` prints the
-- INSERT statement to run here.
-- -----------------------------------------------------------------------------
