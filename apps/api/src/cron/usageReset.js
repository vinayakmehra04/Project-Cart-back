const cron = require('node-cron');
const { supabase } = require('../config/database');

/**
 * Monthly Usage Reset
 * Runs at midnight on the 1st of every month
 * 1. Snapshots current usage into usage_logs
 * 2. Resets monthly counters to 0
 */
function startUsageResetCron() {
  // Run at 00:00 on day 1 of every month
  cron.schedule('0 0 1 * *', async () => {
    console.log('🔄 Running monthly usage reset...');

    try {
      const now = new Date();
      const periodEnd = now.toISOString().split('T')[0];

      // Get all active clients with their usage
      const { data: clients, error } = await supabase
        .from('clients')
        .select('id, messages_sent_this_month, carts_tracked_this_month, current_period_start')
        .eq('is_active', true);

      if (error) throw error;

      for (const client of clients || []) {
        // 1. Snapshot into usage_logs
        const periodStart = client.current_period_start
          ? new Date(client.current_period_start).toISOString().split('T')[0]
          : new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];

        // Get recovery stats for the period
        const { data: recoveries } = await supabase
          .from('recovery_events')
          .select('order_total')
          .eq('client_id', client.id)
          .gte('created_at', client.current_period_start || periodStart);

        const revenueRecovered = (recoveries || []).reduce(
          (sum, r) => sum + parseFloat(r.order_total || 0),
          0
        );

        const { count: recoveredCount } = await supabase
          .from('carts')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', client.id)
          .eq('status', 'recovered')
          .gte('created_at', client.current_period_start || periodStart);

        await supabase.from('usage_logs').upsert(
          {
            client_id: client.id,
            period_start: periodStart,
            period_end: periodEnd,
            messages_sent: client.messages_sent_this_month || 0,
            carts_tracked: client.carts_tracked_this_month || 0,
            carts_recovered: recoveredCount || 0,
            revenue_recovered: revenueRecovered,
          },
          { onConflict: 'client_id,period_start' }
        );

        // 2. Reset counters
        await supabase
          .from('clients')
          .update({
            messages_sent_this_month: 0,
            carts_tracked_this_month: 0,
            current_period_start: now.toISOString(),
          })
          .eq('id', client.id);
      }

      console.log(`✅ Usage reset complete for ${clients?.length || 0} clients`);
    } catch (err) {
      console.error('❌ Usage reset failed:', err);
    }
  });

  console.log('⏰ Monthly usage reset cron scheduled (1st of every month)');
}

module.exports = { startUsageResetCron };
