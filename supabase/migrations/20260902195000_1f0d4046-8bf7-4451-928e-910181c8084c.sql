-- Migration: Implement Rate Limiting for API Protection
--
-- This migration:
-- 1. Creates rate limit tracking tables for API requests
-- 2. Implements token bucket algorithm for fair rate limiting
-- 3. Tracks rate limit usage per API key and user
-- 4. Stores rate limit events for monitoring and alerting
-- 5. Provides database-level enforcement of rate limits

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enum for rate limit status
CREATE TYPE rate_limit_status AS ENUM ('allowed', 'blocked', 'warning');

-- Table to track rate limit buckets per API key/user
-- Uses token bucket algorithm: tokens refill over time, depleted on requests
CREATE TABLE public.rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text NOT NULL UNIQUE,
  user_id uuid,
  tenant_id uuid,

  -- Token bucket algorithm parameters
  tokens_remaining integer NOT NULL DEFAULT 120, -- Tokens available
  tokens_capacity integer NOT NULL DEFAULT 120,  -- Max tokens
  refill_rate integer NOT NULL DEFAULT 2,         -- Tokens per minute
  refill_interval interval NOT NULL DEFAULT '1 minute'::interval,

  -- Tracking
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  last_request_at timestamptz,
  total_requests bigint NOT NULL DEFAULT 0,
  blocked_requests bigint NOT NULL DEFAULT 0,

  -- Configuration
  is_unlimited boolean NOT NULL DEFAULT false,
  is_blocked boolean NOT NULL DEFAULT false,
  block_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Table for rate limit events (for monitoring and alerts)
CREATE TABLE public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text NOT NULL,
  user_id uuid,
  tenant_id uuid,

  -- Request details
  endpoint text NOT NULL,
  method text NOT NULL,
  ip_address inet,
  user_agent text,

  -- Rate limit status at time of request
  status rate_limit_status NOT NULL,
  tokens_remaining integer NOT NULL,
  tokens_used integer NOT NULL DEFAULT 1,

  -- Tracking
  timestamp timestamptz NOT NULL DEFAULT now(),
  request_id text
);

-- Table for IP-based rate limiting (DDoS protection)
CREATE TABLE public.rate_limit_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL UNIQUE,

  -- Token bucket for IP
  tokens_remaining integer NOT NULL DEFAULT 600,     -- 10 req/sec limit
  tokens_capacity integer NOT NULL DEFAULT 600,
  refill_rate integer NOT NULL DEFAULT 10,

  -- Tracking
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  last_request_at timestamptz,
  total_requests bigint NOT NULL DEFAULT 0,
  blocked_requests bigint NOT NULL DEFAULT 0,

  -- Block status
  is_blocked boolean NOT NULL DEFAULT false,
  block_expires_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_rate_limit_buckets_api_key ON public.rate_limit_buckets(api_key);
CREATE INDEX idx_rate_limit_buckets_user_id ON public.rate_limit_buckets(user_id);
CREATE INDEX idx_rate_limit_events_timestamp ON public.rate_limit_events(timestamp DESC);
CREATE INDEX idx_rate_limit_events_api_key ON public.rate_limit_events(api_key);
CREATE INDEX idx_rate_limit_ips_ip_address ON public.rate_limit_ips(ip_address);

-- Function to refill tokens based on elapsed time
CREATE OR REPLACE FUNCTION refill_rate_limit_tokens(
  p_bucket_id uuid
)
RETURNS integer AS $$
DECLARE
  v_bucket public.rate_limit_buckets%ROWTYPE;
  v_elapsed_minutes numeric;
  v_tokens_to_add integer;
  v_new_tokens integer;
BEGIN
  -- Get current bucket
  SELECT * INTO v_bucket FROM public.rate_limit_buckets WHERE id = p_bucket_id FOR UPDATE;

  IF v_bucket IS NULL THEN
    RETURN 0;
  END IF;

  -- Calculate elapsed time and tokens to add
  v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_bucket.last_refill_at)) / 60;
  v_tokens_to_add := floor(v_elapsed_minutes * v_bucket.refill_rate)::integer;

  -- Cap tokens at capacity
  v_new_tokens := LEAST(
    v_bucket.tokens_remaining + v_tokens_to_add,
    v_bucket.tokens_capacity
  );

  -- Update bucket if tokens changed
  IF v_new_tokens != v_bucket.tokens_remaining THEN
    UPDATE public.rate_limit_buckets
    SET
      tokens_remaining = v_new_tokens,
      last_refill_at = now(),
      updated_at = now()
    WHERE id = p_bucket_id;
  END IF;

  RETURN v_new_tokens;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check and consume rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_api_key text,
  p_tokens_needed integer DEFAULT 1,
  p_ip_address inet DEFAULT NULL
)
RETURNS TABLE(
  allowed boolean,
  tokens_remaining integer,
  reset_after integer,
  status rate_limit_status
) AS $$
DECLARE
  v_bucket public.rate_limit_buckets%ROWTYPE;
  v_ip_limit public.rate_limit_ips%ROWTYPE;
  v_new_tokens integer;
  v_ip_new_tokens integer;
  v_allowed boolean := true;
  v_status rate_limit_status := 'allowed'::rate_limit_status;
BEGIN
  -- Check if API key is blocked
  SELECT * INTO v_bucket FROM public.rate_limit_buckets
  WHERE api_key = p_api_key FOR UPDATE;

  IF v_bucket.is_blocked THEN
    RETURN QUERY SELECT false, 0, -1, 'blocked'::rate_limit_status;
    RETURN;
  END IF;

  -- Refill tokens based on elapsed time
  v_new_tokens := refill_rate_limit_tokens(v_bucket.id);

  -- Check IP-based limit if provided
  IF p_ip_address IS NOT NULL THEN
    SELECT * INTO v_ip_limit FROM public.rate_limit_ips
    WHERE ip_address = p_ip_address FOR UPDATE;

    IF v_ip_limit IS NOT NULL AND v_ip_limit.is_blocked THEN
      IF v_ip_limit.block_expires_at IS NULL OR v_ip_limit.block_expires_at > now() THEN
        RETURN QUERY SELECT false, 0, -1, 'blocked'::rate_limit_status;
        RETURN;
      ELSE
        -- Unblock expired IP
        UPDATE public.rate_limit_ips
        SET is_blocked = false, block_expires_at = NULL
        WHERE id = v_ip_limit.id;
      END IF;
    END IF;
  END IF;

  -- Check if enough tokens available
  IF v_new_tokens >= p_tokens_needed THEN
    -- Consume tokens
    UPDATE public.rate_limit_buckets
    SET
      tokens_remaining = v_new_tokens - p_tokens_needed,
      total_requests = total_requests + 1,
      last_request_at = now(),
      updated_at = now()
    WHERE id = v_bucket.id;

    -- Warn if approaching limit
    IF (v_new_tokens - p_tokens_needed) < (v_bucket.tokens_capacity / 5) THEN
      v_status := 'warning'::rate_limit_status;
    END IF;

    RETURN QUERY SELECT true, (v_new_tokens - p_tokens_needed),
      CEIL(EXTRACT(EPOCH FROM v_bucket.refill_interval))::integer, v_status;
  ELSE
    -- Rate limit exceeded
    UPDATE public.rate_limit_buckets
    SET
      blocked_requests = blocked_requests + 1,
      updated_at = now()
    WHERE id = v_bucket.id;

    -- Optionally block IP if too many failures
    IF p_ip_address IS NOT NULL THEN
      UPDATE public.rate_limit_ips
      SET blocked_requests = blocked_requests + 1
      WHERE ip_address = p_ip_address;
    END IF;

    RETURN QUERY SELECT false, 0,
      CEIL(EXTRACT(EPOCH FROM v_bucket.refill_interval))::integer, 'blocked'::rate_limit_status;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log rate limit events
CREATE OR REPLACE FUNCTION log_rate_limit_event(
  p_api_key text,
  p_endpoint text,
  p_method text,
  p_status rate_limit_status,
  p_tokens_remaining integer,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.rate_limit_events (
    api_key,
    endpoint,
    method,
    ip_address,
    user_agent,
    status,
    tokens_remaining,
    request_id
  ) VALUES (
    p_api_key,
    p_endpoint,
    p_method,
    p_ip_address,
    p_user_agent,
    p_status,
    p_tokens_remaining,
    p_request_id
  );
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the request if logging fails
  RAISE WARNING 'Failed to log rate limit event: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to block an API key
CREATE OR REPLACE FUNCTION block_api_key(
  p_api_key text,
  p_reason text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE public.rate_limit_buckets
  SET
    is_blocked = true,
    block_reason = p_reason,
    updated_at = now()
  WHERE api_key = p_api_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to block an IP address
CREATE OR REPLACE FUNCTION block_ip_address(
  p_ip_address inet,
  p_duration interval DEFAULT '1 hour'::interval
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.rate_limit_ips (
    ip_address,
    is_blocked,
    block_expires_at
  ) VALUES (
    p_ip_address,
    true,
    now() + p_duration
  )
  ON CONFLICT (ip_address) DO UPDATE
  SET
    is_blocked = true,
    block_expires_at = now() + p_duration,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup job: remove old rate limit events (older than 30 days)
-- Run daily via pg_cron
SELECT cron.schedule(
  'cleanup_rate_limit_events',
  '0 2 * * *', -- 2 AM daily
  $$DELETE FROM public.rate_limit_events
    WHERE timestamp < now() - interval '30 days'$$
);

-- Cleanup job: unblock IPs with expired blocks
SELECT cron.schedule(
  'cleanup_rate_limit_ips',
  '*/5 * * * *', -- Every 5 minutes
  $$UPDATE public.rate_limit_ips
    SET is_blocked = false, block_expires_at = NULL
    WHERE is_blocked = true
      AND block_expires_at IS NOT NULL
      AND block_expires_at <= now()$$
);

-- Trigger for updated_at
CREATE TRIGGER update_rate_limit_buckets_updated_at
  BEFORE UPDATE ON public.rate_limit_buckets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rate_limit_ips_updated_at
  BEFORE UPDATE ON public.rate_limit_ips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE public.rate_limit_buckets IS 'Tracks rate limit usage per API key using token bucket algorithm';
COMMENT ON TABLE public.rate_limit_events IS 'Audit log for all rate limit events for monitoring and alerting';
COMMENT ON TABLE public.rate_limit_ips IS 'IP-based rate limiting for DDoS protection';
COMMENT ON FUNCTION check_rate_limit IS 'Check and consume rate limit tokens. Returns allowed status and remaining tokens.';
COMMENT ON FUNCTION log_rate_limit_event IS 'Log a rate limit event for auditing and monitoring';
COMMENT ON FUNCTION block_api_key IS 'Block an API key from making requests';
COMMENT ON FUNCTION block_ip_address IS 'Block an IP address for a specified duration';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_rate_limit(text, integer, inet) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION log_rate_limit_event(text, text, text, rate_limit_status, integer, inet, text, text) TO authenticated, anon;
