
-- Create storage bucket for tenant logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-logos', 'tenant-logos', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

-- RLS for tenant-logos bucket
CREATE POLICY "Anyone can view tenant logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tenant-logos');

CREATE POLICY "Tenant admins can upload logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'tenant-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Tenant admins can update logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'tenant-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Tenant admins can delete logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'tenant-logos' AND auth.role() = 'authenticated');
