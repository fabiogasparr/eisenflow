# Security Configuration Guide

This document provides instructions for properly configuring security-sensitive settings in the EisenFlow application.

## Table of Contents
1. [Google OAuth Token Encryption](#google-oauth-token-encryption)
2. [Supabase Vault Setup](#supabase-vault-setup)
3. [Environment Variables](#environment-variables)
4. [Security Best Practices](#security-best-practices)
5. [Audit Logging](#audit-logging)

---

## Google OAuth Token Encryption

### Overview
Google OAuth tokens (access tokens and refresh tokens) are sensitive credentials that must never be stored in plain text. This application uses Supabase Vault with AES-256 encryption for secure token storage.

### Why This Matters
- **Access tokens** allow anyone with them to impersonate a user on Google Calendar
- **Refresh tokens** can be used to obtain new access tokens indefinitely
- Plain text storage exposes these tokens if the database is compromised
- Industry standard: Always encrypt sensitive tokens at rest

### Setup Instructions

#### Step 1: Generate Encryption Key
Generate a 32-byte (256-bit) key for AES-256 encryption:

```bash
# Generate a cryptographically secure random key
openssl rand -base64 32
# Example output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0

# Or using Python:
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

#### Step 2: Create Vault Secret in Supabase

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query and run:

```sql
-- Create the secret in Supabase Vault
select vault.create_secret(
  'GOOGLE_TOKENS_ENCRYPTION_KEY',
  'your-generated-key-here',
  'Google OAuth token encryption master key'
);
```

**Important**: Replace `'your-generated-key-here'` with the actual key you generated.

#### Step 3: Verify Encryption Key is Set

```sql
-- Check if the key exists (without revealing its value)
select name, description from vault.secrets where name = 'GOOGLE_TOKENS_ENCRYPTION_KEY';
```

You should see output like:
```
name: GOOGLE_TOKENS_ENCRYPTION_KEY
description: Google OAuth token encryption master key
```

#### Step 4: Deploy Migration

The encryption migration is included in this pull request:
```sql
20260902194454_1f0d4046-8bf7-4451-928e-910181c8084b.sql
```

After setting up the Vault secret, run this migration on your Supabase project:

```bash
# Using Supabase CLI
supabase migration up

# Or via the Supabase dashboard:
# - Copy the migration SQL
# - Go to SQL Editor
# - Create new query and run it
```

---

## Supabase Vault Setup

### What is Vault?
Supabase Vault is an encrypted key-value store for sensitive data. Unlike .env files:
- Values are encrypted at rest
- They never appear in logs
- Access is controlled via database RLS policies
- They're never exposed to the client

### Creating Additional Secrets

```sql
-- Generic syntax for creating secrets
select vault.create_secret(
  'SECRET_NAME',
  'secret-value',
  'Human-readable description'
);

-- Retrieve a secret (only from server-side context)
select vault.get_secret('SECRET_NAME');

-- Update a secret
select vault.update_secret(
  'SECRET_NAME',
  'new-secret-value',
  'Updated description'
);

-- Delete a secret
select vault.delete_secret('SECRET_NAME');

-- List all secrets (without revealing values)
select name, description from vault.secrets;
```

### Security Policy
- **Never** store secrets in .env files
- **Never** commit .env files to git
- **Never** log secret values
- **Always** use Vault for sensitive data
- **Always** rotate secrets regularly
- **Always** audit secret access

---

## Environment Variables

### Required for Edge Functions

These must be set in Supabase Edge Functions environment:

```bash
# Required
GOOGLE_CLIENT_ID              # Google OAuth Client ID
GOOGLE_CLIENT_SECRET          # Google OAuth Client Secret (from Vault)
SUPABASE_URL                  # Your Supabase project URL
SUPABASE_ANON_KEY             # Supabase anonymous key
SUPABASE_SERVICE_ROLE_KEY     # Supabase service role key

# Optional
GOOGLE_TOKENS_ENCRYPTION_KEY  # Can also be retrieved from Vault
```

### Environment Variable Setup in Supabase

1. Go to **Project Settings** → **Functions**
2. Set the following:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

For sensitive values like `GOOGLE_CLIENT_SECRET`, consider storing them in Vault instead:

```sql
select vault.create_secret(
  'GOOGLE_CLIENT_SECRET',
  'your-secret',
  'Google OAuth Client Secret'
);
```

Then in your edge function:
```typescript
// Retrieve from Vault instead of environment
const secret = await supabase
  .from('secrets')
  .select('secret')
  .eq('name', 'GOOGLE_CLIENT_SECRET')
  .single();
```

---

## Security Best Practices

### Token Management

#### Access Token Rotation
Access tokens expire every 3600 seconds (1 hour). The application automatically:
1. Detects when a token is expired
2. Uses the refresh token to obtain a new access token
3. Encrypts and stores the new access token
4. Logs the rotation for audit purposes

#### Token Lifecycle
```
1. User authorizes via OAuth → Google returns tokens
2. Edge function encrypts tokens using Vault key
3. Encrypted tokens stored in database
4. On API call: retrieve encrypted token, decrypt on-demand
5. If expired: use refresh token to get new access token
6. New access token is encrypted and stored
7. Old access token is discarded
```

### Database Security

#### Row-Level Security (RLS)
All tables with sensitive data have RLS enabled:
- Users can only view/modify their own tokens
- Super admins can view all tokens (with audit logging)
- Service role bypasses RLS only for authorized operations

#### Audit Logging
Every token operation is logged:
- `TOKEN_SAVED_ENCRYPTED` - Token successfully encrypted and stored
- `TOKEN_SAVED_UNENCRYPTED_FALLBACK` - Fallback to plain text (warning)
- `TOKEN_ACCESSED` - Token retrieved from database
- `TOKEN_ROTATED` - Access token rotated using refresh token
- `TOKEN_DELETED` - Token explicitly removed

View audit logs:
```sql
select * from public.google_token_audit_log
where user_id = 'user-uuid'
order by timestamp desc;
```

### API Security

#### Rate Limiting
The application implements rate limiting to prevent:
- Brute force attacks
- Credential stuffing
- DDoS attacks

Default limits:
- 120 requests per minute per API key
- 600 requests per hour per user

#### CORS Configuration
Only allow requests from trusted domains:
```typescript
// In edge functions
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://yourdomain.com",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};
```

### Code Security

#### Never Log Secrets
```typescript
// ❌ WRONG - Never do this!
console.log("Token:", accessToken);

// ✅ CORRECT
console.log("Token saved successfully");
```

#### Client vs Server Context
```typescript
// ❌ WRONG - Encryption in client
const encrypted = await encryptToken(token, key);

// ✅ CORRECT - Encryption in edge function
// Call edge function from client, encryption happens server-side
```

#### Input Validation
Always validate and sanitize input:
```typescript
// Validate user ID format
if (!isValidUUID(userId)) {
  throw new Error("Invalid user ID");
}

// Validate token format
if (typeof token !== 'string' || token.length === 0) {
  throw new Error("Invalid token");
}
```

---

## Audit Logging

### Viewing Audit Logs

All token operations are logged in `google_token_audit_log`:

```sql
-- View all token operations for a user
select 
  id,
  user_id,
  action,
  timestamp,
  ip_address
from public.google_token_audit_log
where user_id = 'user-uuid'
order by timestamp desc
limit 50;

-- View suspicious activities (multiple failures in short time)
select 
  user_id,
  action,
  count(*) as count,
  min(timestamp) as first_attempt,
  max(timestamp) as last_attempt
from public.google_token_audit_log
where action like '%FAILED%'
  and timestamp > now() - interval '1 hour'
group by user_id, action
having count(*) > 5;
```

### Alerting
Monitor for suspicious patterns:
- Multiple token deletions
- Tokens accessed from unusual locations
- Failed rotation attempts
- Unencrypted token fallbacks

---

## Incident Response

### If Tokens are Compromised

1. **Immediate**: Revoke Google OAuth consent in [Account Settings](https://myaccount.google.com/permissions)
2. **Database**: Delete compromised tokens
   ```sql
   delete from google_calendar_tokens where user_id = 'compromised-user-uuid';
   ```
3. **User**: Ask them to re-authorize (they'll create new tokens)
4. **Audit**: Review `google_token_audit_log` to understand the breach
5. **Follow-up**: 
   - Rotate encryption key if backup keys were exposed
   - Review access logs for all sensitive data
   - Update password if needed

### If Encryption Key is Compromised

1. **Immediate**: Generate new encryption key
2. **Backup**: Keep old key temporarily
3. **Re-encrypt**: Run migration to re-encrypt all tokens with new key
4. **Vault**: Update the secret
5. **Cleanup**: Remove old key after re-encryption completes

---

## Testing Security

### Local Development Testing

```bash
# Verify encryption is working
# Check that access_token and refresh_token columns are NULL
# Check that access_token_encrypted and refresh_token_encrypted have values

select 
  user_id,
  access_token is not null as has_plain_access_token,
  access_token_encrypted is not null as has_encrypted_access_token,
  encryption_method
from google_calendar_tokens;
```

### Production Verification

```sql
-- Verify NO tokens are in plain text
select count(*) as plain_text_tokens
from google_calendar_tokens
where access_token is not null
  and encryption_method != 'vault';

-- Should return: 0
```

---

## Compliance & Standards

This implementation follows:
- **OWASP**: Secure cryptographic storage
- **PCI DSS**: If handling payment card data
- **ISO 27001**: Information security management
- **SOC 2**: Security, availability, processing integrity

---

## Support & Questions

For security concerns or questions:
1. Review this guide
2. Check Supabase documentation: https://supabase.com/docs/guides/security
3. Report security issues: security@eisenflow.app (or your security contact)
4. Do NOT create public issues for security vulnerabilities
