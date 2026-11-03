// Admin-only user management. Uses the service-role key, which never leaves the server.
// Deploy: supabase functions deploy admin-users
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Must match EMAIL_DOMAIN in src/lib/config.js
const EMAIL_DOMAIN = Deno.env.get('EMAIL_DOMAIN') ?? 'santa.local';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') return json({ error: 'Admins only' }, 403);

    const body = await req.json();
    const { data: ev } = await admin.from('event').select('status').eq('id', 1).single();
    const started = ev?.status === 'started';

    if (body.action === 'create') {
      if (started) return json({ error: 'The event has started. Reset it before adding users.' }, 400);
      const username = String(body.username ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
        return json({ error: 'Username: 3-24 characters, letters, numbers, . _ -' }, 400);
      }
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${username}@${EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from('profiles').insert({ id: created.user.id, username, role });
      if (pErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: pErr.message.includes('duplicate') ? 'Username already exists' : pErr.message }, 400);
      }
      return json({ ok: true });
    }

    if (body.action === 'delete') {
      if (started) return json({ error: 'The event has started. Reset it before deleting users.' }, 400);
      if (body.id === user.id) return json({ error: "You can't delete your own account" }, 400);
      // Best-effort cleanup of the user's uploaded images.
      for (const folder of [body.id, `${body.id}/hints`]) {
        const { data: files } = await admin.storage.from('photos').list(folder);
        const paths = (files ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
        if (paths.length) await admin.storage.from('photos').remove(paths);
      }
      const { error } = await admin.auth.admin.deleteUser(body.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === 'set_password') {
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
