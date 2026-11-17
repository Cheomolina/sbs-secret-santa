# 🎅 Secret Santa

Company Secret Santa web app. Static front end (React + Vite) on **GitHub Pages**, backend on **Supabase** (login, database, photo storage).

- Accounts are created **only by an admin** (username + password, no email).
- Each user has a profile photo and a list of gift hints (name, image, description, link).
- The draw produces a single random loop: nobody gets themselves, nobody gets a 2-person swap. Users only ever see their own target; **nobody, admin included, can read the other pairs** (enforced by database row-level security).
- The draw runs **automatically** once the draw date passes (checked every 5 minutes), or the admin can start it manually. The admin can also run an **event test** that verifies the algorithm and shows one sample draw (nothing is saved).
- **Event details** page: gift exchange date, place, budget and notes.
- **No repeats**: each draw avoids last year's pairs (can be switched off).
- **On/off + replace system**: the admin can turn participants off. Once at least 2 have left, *Replace participants* re-pairs only the people left without a giver or giftee; everyone else keeps their target.
- **Next year**: *Close event & start next year* archives the edition (kept as history for the no-repeat rule) and opens a new one with the same users.
- A scheduled workflow pings the database every 3 days so the free Supabase project doesn't pause.

## One-time setup

### 1. Supabase
1. Create a free project at <https://supabase.com>.
2. **SQL Editor** → run [`supabase/schema.sql`](supabase/schema.sql). It also upgrades an existing v1 database in place, and is safe to run again after pulling updates.
3. **SQL Editor** → run [`supabase/cron.sql`](supabase/cron.sql) (enables the automatic draw).
4. **Authentication → Users → Add user → Create new user**: email `admin@santa.local`, a strong password, tick *Auto Confirm User*. Then run [`supabase/seed_admin.sql`](supabase/seed_admin.sql) in the SQL Editor.
5. Deploy the admin function (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy admin-users
   ```
6. Note your **Project URL** and **anon key** (Project Settings → API).

### 2. GitHub
1. Create a **public** repo and push this folder to the `main` branch.
2. Repo → **Settings → Secrets and variables → Actions → Variables** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Repo → **Settings → Pages** → Source: **GitHub Actions**.
4. Push to `main` (or run the workflow manually). The site appears at `https://<user>.github.io/<repo>/`.

The anon key is designed to be public; all protection comes from the row-level security rules in `schema.sql`. Never put the `service_role` key in the front end or the repo.

## Local development
```bash
cp .env.example .env.local   # fill in the two values
npm install
npm run dev
```

## Using it
1. Sign in as the admin → **Admin** → create a user for each colleague (give them their password).
2. On the **Event** page set the draw date, exchange date, place and budget. Run **Run event test** (Admin) to check everything is ready.
3. Users sign in, add a photo and hints. On the date, the draw runs and **Home** shows each person their target.

Notes
- Usernames map to internal emails `username@santa.local`. If Supabase ever rejects that domain, change it in `src/lib/config.js` and the `EMAIL_DOMAIN` secret of the function.
- Once the draw is done, users can't be added or deleted (it would break the loop): turn them **off** instead. Admin → *Reset event* erases the draw so it can be redone.
- The replace system needs at least 2 leavers (`min_leavers` in `repair_event()` and `MIN_LEAVERS` in `src/pages/Admin.jsx`).
- After changing `supabase/functions/admin-users`, redeploy it with `supabase functions deploy admin-users`.
- GitHub turns off scheduled workflows after 60 days without repo activity. If the keep-alive stops, re-enable it in the Actions tab.
- Photos are stored in a public bucket (images are viewable by anyone who has the exact URL), but only logged-in users can list them.
