ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS cold_visit_clinic_name text,
ADD COLUMN IF NOT EXISTS cold_visit_address text,
ADD COLUMN IF NOT EXISTS cold_visit_doctor_name text,
ADD COLUMN IF NOT EXISTS cold_visit_doctor_specialty text,
ADD COLUMN IF NOT EXISTS cold_visit_client_email text,
ADD COLUMN IF NOT EXISTS cold_visit_client_rut text;
