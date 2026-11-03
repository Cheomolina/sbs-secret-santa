// Usernames are mapped to internal emails so no real email is needed.
// Must match EMAIL_DOMAIN in the admin-users Edge Function.
export const EMAIL_DOMAIN = 'santa.local';
// Accepts either "jose" or the full "jose@santa.local".
export const usernameToEmail = (u) => {
  const name = u.trim().toLowerCase().split('@')[0];
  return `${name}@${EMAIL_DOMAIN}`;
};
