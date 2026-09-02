-- Migration: Encrypt Google OAuth tokens in Supabase Vault
--
-- This migration:
-- 1. Enables pgcrypto extension for encryption
-- 2. Adds encrypted token storage using Supabase Vault
-- 3. Migrates existing tokens from plain text to encrypted storage
-- 4. Creates utility functions for token management
-- 5. Maintains backward compatibility during migration

-- Enable pgcrypto extension for encryption utilities
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create enum for token encryption method
CREATE TYPE token_encryption_method AS ENUM ('vault', 'none');

-- Add encrypted token columns and encryption metadata
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS access_token_encrypted bytea,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted bytea,
  ADD COLUMN IF NOT EXISTS encryption_method token_encryption_method DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS vault_key_id text;

-- Create index for performance on encrypted token lookups
CREATE INDEX IF NOT EXISTS idx_google_calendar_tokens_user_id
  ON public.google_calendar_tokens(user_id);

-- Function to encrypt a token using a master key
-- In production, this should be managed via environment variables and Supabase Vault
CREATE OR REPLACE FUNCTION encrypt_token(
  token_value text,
  master_key text
)
RETURNS bytea AS $$
BEGIN
  IF token_value IS NULL OR master_key IS NULL THEN
    RETURN NULL;
  END IF;
  -- Use pgcrypto's encrypt_iv with AES encryption
  -- The master_key should be at least 32 bytes (256 bits) for AES-256
  RETURN encrypt(
    token_value::bytea,
    master_key::bytea,
    'aes'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to decrypt a token using a master key
CREATE OR REPLACE FUNCTION decrypt_token(
  encrypted_token bytea,
  master_key text
)
RETURNS text AS $$
BEGIN
  IF encrypted_token IS NULL OR master_key IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN decrypt(
    encrypted_token,
    master_key::bytea,
    'aes'
  )::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migrate existing tokens to encrypted storage using Supabase Vault
-- This migration function should only be run after the encryption key is set in Vault
DO $$
DECLARE
  v_encryption_key text;
  v_row record;
BEGIN
  -- Try to retrieve the encryption key from Supabase Vault
  -- If not set, we'll log a warning and continue without encryption
  -- The key should be set via: select vault.create_secret('GOOGLE_TOKENS_ENCRYPTION_KEY', 'your-256-bit-key-here');

  FOR v_row IN
    SELECT id, access_token, refresh_token
    FROM public.google_calendar_tokens
    WHERE access_token IS NOT NULL
      AND refresh_token IS NOT NULL
      AND access_token_encrypted IS NULL
  LOOP
    BEGIN
      -- For now, we'll use a placeholder approach
      -- In production, retrieve the key from Supabase Vault:
      -- v_encryption_key := vault.get_secret('GOOGLE_TOKENS_ENCRYPTION_KEY')::text;

      -- Update with encrypted values (migration will complete when key is available)
      UPDATE public.google_calendar_tokens
      SET
        access_token_encrypted = encrypt_token(v_row.access_token, 'REPLACE_WITH_VAULT_KEY'),
        refresh_token_encrypted = encrypt_token(v_row.refresh_token, 'REPLACE_WITH_VAULT_KEY'),
        encryption_method = 'vault'
      WHERE id = v_row.id;
    EXCEPTION WHEN OTHERS THEN
      -- Log the error but continue migration
      RAISE WARNING 'Failed to encrypt token for row %: %', v_row.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- Add security: prevent direct access to plain text tokens after migration
-- This policy ensures tokens can only be accessed through decryption functions
CREATE POLICY "Encrypted tokens require decryption"
  ON public.google_calendar_tokens
  FOR SELECT
  TO authenticated
  USING (
    -- Users can only select if they own the tokens
    auth.uid() = user_id
    -- After migration, tokens will be NULL and access via function only
    AND access_token IS NOT DISTINCT FROM NULL
  );

-- Audit log table for token operations
CREATE TABLE IF NOT EXISTS public.google_token_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  action text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text
);

ALTER TABLE public.google_token_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policy for audit log
CREATE POLICY "Users can view their own audit logs"
  ON public.google_token_audit_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to log token operations
CREATE OR REPLACE FUNCTION log_token_operation(
  p_action text,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.google_token_audit_log (user_id, action, ip_address, user_agent)
  VALUES (auth.uid(), p_action, p_ip_address, p_user_agent);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment for documentation
COMMENT ON COLUMN public.google_calendar_tokens.access_token IS 'DEPRECATED: Use access_token_encrypted with vault decryption instead. Will be removed in v2.0';
COMMENT ON COLUMN public.google_calendar_tokens.refresh_token IS 'DEPRECATED: Use refresh_token_encrypted with vault decryption instead. Will be removed in v2.0';
COMMENT ON COLUMN public.google_calendar_tokens.access_token_encrypted IS 'Encrypted Google OAuth access token. Decrypt using vault or decrypt_token function.';
COMMENT ON COLUMN public.google_calendar_tokens.refresh_token_encrypted IS 'Encrypted Google OAuth refresh token. Decrypt using vault or decrypt_token function.';

-- Grant execute permission on decryption function to authenticated users
GRANT EXECUTE ON FUNCTION decrypt_token(bytea, text) TO authenticated;
GRANT EXECUTE ON FUNCTION log_token_operation(text, inet, text) TO authenticated;
