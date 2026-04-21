-- RUN THIS TO MANUALLY FIX THE HOSPITAL MAPPING IDENTITY
-- Ensure `hospitals` has the `user_id` column first (already deployed in earlier migrations)
-- Note: Replace '<auth_user_id>' with the UUID found inside your Supabase Auth user table

UPDATE public.hospitals 
SET user_id = '<auth_user_id>' 
WHERE email = 'Nexus12345@gmail.com';
