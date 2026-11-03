-- Creates the FIRST admin. Before running this:
--   Supabase dashboard -> Authentication -> Users -> Add user -> Create new user
--   Email: admin@santa.local   Password: (your choice)   tick "Auto Confirm User"
-- Then run this script. (Change the username below if you used a different email prefix.)
insert into public.profiles (id, username, role)
select id, split_part(email, '@', 1), 'admin'
from auth.users
where email = 'admin@santa.local'
on conflict (id) do update set role = 'admin';
