# Cloudflare Pages R2 Binding Notes

This note explains an R2 binding deployment failure that can occur before Seraph's Pictures code runs.

## Symptom

Cloudflare Pages rejects a deployment with a message similar to:

```txt
binding R2_BUCKET of type r2_bucket contains an invalid jurisdiction
```

## Cause

The Pages project has invalid R2 binding metadata. Normal R2 buckets should not set a residency jurisdiction. Only residency-restricted buckets use values such as `eu` or `fedramp`.

## Fix

1. Open the Cloudflare Pages project settings.
2. Remove the broken `R2_BUCKET` binding from Production and Preview.
3. Recreate the binding and select the correct bucket without an invalid jurisdiction.
4. Redeploy Seraph's Pictures.

## Alternative

If native Pages R2 binding remains blocked, remove `R2_BUCKET` and configure Cloudflare R2 through the S3-compatible storage settings instead.

## Validation

```bash
npm run pages:r2:doctor -- --check
```
