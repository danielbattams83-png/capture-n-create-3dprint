-- Allow text-to-image tasks in the existing jobs table.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('model', 'texture', 'image'));

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_task_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_task_type_check CHECK (
  meshy_task_type IS NULL
  OR meshy_task_type IN ('image-to-3d', 'multi-image-to-3d', 'retexture', 'text-to-image')
);
