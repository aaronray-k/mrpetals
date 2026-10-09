-- Senior QC (item 4): a QC user that may also clear Major QC failures. Admin grants it next to
-- the QC role. Its own migration, because a new enum value can only be used once committed.
alter type public.app_role add value if not exists 'senior_qc';
