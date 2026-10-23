-- ============================================================================
-- HDSAT — remove the retired arithmetic captcha
-- ============================================================================
-- Run this only after the build that calls
-- `admin_unlock(p_passcode, p_challenge_id, p_nonce)` is deployed. Until then
-- the three-argument captcha overload is what the live console uses.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_captcha_challenge();

DROP FUNCTION IF EXISTS public.admin_unlock(TEXT, UUID, TEXT);

DROP TABLE IF EXISTS public.admin_captcha;

NOTIFY pgrst, 'reload schema';
