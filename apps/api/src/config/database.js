const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
});

module.exports = { supabase };
