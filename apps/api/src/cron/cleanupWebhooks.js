const cron = require('node-cron');
const { supabase } = require('../config/database');

/**
 * Webhook Cleanup Cron
 * Runs daily at 3 AM — deletes processed webhook logs older than 30 days
 */
function startWebhookCleanupCron() {
  // Run at 03:00 every day
  cron.schedule('0 3 * * *', async () => {
    console.log('🧹 Cleaning up old webhook logs...');

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { count, error } = await supabase
        .from('webhook_events_raw')
        .delete({ count: 'exact' })
        .eq('processed', true)
        .lt('created_at', thirtyDaysAgo);

      if (error) throw error;
      console.log(`✅ Cleaned up ${count || 0} old webhook logs`);

      // Also expire old active carts (no activity for 7+ days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: expiredCount } = await supabase
        .from('carts')
        .update({ status: 'expired' }, { count: 'exact' })
        .eq('status', 'active')
        .lt('last_activity_at', sevenDaysAgo);

      if (expiredCount > 0) {
        console.log(`✅ Expired ${expiredCount} stale carts`);
      }
    } catch (err) {
      console.error('❌ Webhook cleanup failed:', err);
    }
  });

  console.log('⏰ Webhook cleanup cron scheduled (daily at 3 AM)');
}

module.exports = { startWebhookCleanupCron };
