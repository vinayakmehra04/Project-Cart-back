'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

const API = process.env.NEXT_PUBLIC_API_URL;

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className='bg-gray-900 border border-gray-800 rounded-2xl p-6'>
      <p className='text-gray-400 text-sm mb-1'>{label}</p>
      <p className='text-white text-3xl font-bold'>{value}</p>
      {sub && <p className='text-gray-500 text-sm mt-1'>{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [carts, setCarts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const clientData = localStorage.getItem('client');
    if (!token) { router.push('/login'); return; }
    if (clientData) setClient(JSON.parse(clientData));
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API}/api/dashboard/stats`, { headers }),
      axios.get(`${API}/api/dashboard/carts?limit=5`, { headers }),
    ]).then(([statsRes, cartsRes]) => {
      setStats(statsRes.data);
      setCarts(cartsRes.data.carts);
    }).catch(() => {
      router.push('/login');
    }).finally(() => setLoading(false));
  }, []);

  function logout() {
    localStorage.clear();
    router.push('/login');
  }

  if (loading) return (
    <div className='min-h-screen bg-gray-950 flex items-center justify-center'>
      <p className='text-white text-xl'>Loading...</p>
    </div>
  );

  return (
    <div className='min-h-screen bg-gray-950 text-white'>
      {/* Header */}
      <div className='border-b border-gray-800 px-8 py-4 flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <span className='text-2xl'>🛒</span>
          <span className='text-xl font-bold'>CartBack</span>
        </div>
        <div className='flex items-center gap-4'>
          <span className='text-gray-400 text-sm'>{client?.name}</span>
          <button onClick={logout} className='text-gray-400 hover:text-white text-sm border border-gray-700 px-3 py-1 rounded-lg'>Logout</button>
        </div>
      </div>

      <div className='px-8 py-8 max-w-7xl mx-auto'>
        <h2 className='text-2xl font-bold mb-6'>Overview</h2>

        {/* Stats Grid */}
        <div className='grid grid-cols-2 md:grid-cols-4 gap-4 mb-8'>
          <StatCard label='Carts Tracked' value={stats?.total_carts || 0} sub='this month' />
          <StatCard label='Abandoned' value={stats?.abandoned_carts || 0} sub={`${stats?.abandonment_rate || 0}% rate`} />
          <StatCard label='Messages Sent' value={stats?.messages_sent || 0} sub='this month' />
          <StatCard label='Recovered' value={stats?.recovered_carts || 0} sub={`${stats?.recovery_rate || 0}% rate`} />
        </div>

        {/* Revenue */}
        <div className='bg-green-500/10 border border-green-500/30 rounded-2xl p-6 mb-8'>
          <p className='text-green-400 text-sm mb-1'>Revenue Recovered</p>
          <p className='text-white text-4xl font-bold'>₹{stats?.revenue_recovered?.toLocaleString() || 0}</p>
          <p className='text-gray-400 text-sm mt-1'>this month</p>
        </div>

        {/* Recent Carts */}
        <h3 className='text-xl font-bold mb-4'>Recent Carts</h3>
        <div className='bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden'>
          <table className='w-full'>
            <thead>
              <tr className='border-b border-gray-800'>
                <th className='text-left text-gray-400 text-sm px-6 py-4'>Customer</th>
                <th className='text-left text-gray-400 text-sm px-6 py-4'>Total</th>
                <th className='text-left text-gray-400 text-sm px-6 py-4'>Status</th>
                <th className='text-left text-gray-400 text-sm px-6 py-4'>Time</th>
              </tr>
            </thead>
            <tbody>
              {carts.length === 0 && (
                <tr><td colSpan={4} className='text-center text-gray-500 py-8'>No carts yet</td></tr>
              )}
              {carts.map((cart: any) => (
                <tr key={cart.id} className='border-b border-gray-800 hover:bg-gray-800/50'>
                  <td className='px-6 py-4'>
                    <p className='text-white'>{cart.customers?.name || 'Unknown'}</p>
                    <p className='text-gray-400 text-sm'>{cart.customers?.phone}</p>
                  </td>
                  <td className='px-6 py-4 text-white font-medium'>₹{cart.cart_total}</td>
                  <td className='px-6 py-4'>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      cart.status === 'recovered' ? 'bg-green-500/20 text-green-400' :
                      cart.status === 'abandoned' ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>{cart.status}</span>
                  </td>
                  <td className='px-6 py-4 text-gray-400 text-sm'>{new Date(cart.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
