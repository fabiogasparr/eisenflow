
-- Fix storage policies - drop existing ones first then recreate with proper checks
DROP POLICY IF EXISTS "Tenant admins can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant admins can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Tenant admins can delete logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view tenant logos" ON storage.objects;

CREATE POLICY "Tenant admins can upload logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id::text = (storage.foldername(name))[1]
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  )
);

CREATE POLICY "Tenant admins can update logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id::text = (storage.foldername(name))[1]
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  )
);

CREATE POLICY "Tenant admins can delete logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id::text = (storage.foldername(name))[1]
    AND user_id = auth.uid()
    AND role IN ('owner', 'admin')
  )
);

CREATE POLICY "Anyone can view tenant logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'tenant-logos');
