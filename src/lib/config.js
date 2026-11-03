// Usernames are mapped to internal emails so no real email is needed.
// Must match EMAIL_DOMAIN in the admin-users Edge Function.
export const EMAIL_DOMAIN = 'santa.local';
export const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
