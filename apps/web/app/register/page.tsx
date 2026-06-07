'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

const API = process.env.NEXT_PUBLIC_API_URL;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', platform: 'custom', website_url: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API}/api/auth/register`, form);
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('client', JSON.stringify(res.data.client));
      alert(`Save your API key — it won't be shown again:\n\n${res.data.api_key}`);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className='min-h-screen bg-gray-950 flex items-center justify-center'>
      <div className='bg-gray-900 p-8 rounded-2xl w-full max-w-md border border-gray-800'>
        <h1 className='text-3xl font-bold text-white mb-2'>🛒 CartBack</h1>
        <p className='text-gray-400 mb-8'>Create your account</p>
        {error && <div className='bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6'>{error}</div>}
        <form onSubmit={handleRegister} className='space-y-4'>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Business Name</label>
            <input type='text' value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none' placeholder='My Store' />
          </div>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Email</label>
            <input type='email' value={form.email} onChange={e => setForm({...form, email: e.target.value})} required className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none' placeholder='you@example.com' />
          </div>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Password</label>
            <input type='password' value={form.password} onChange={e => setForm({...form, password: e.target.value})} required className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none' placeholder='••••••••' />
          </div>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Platform</label>
            <select value={form.platform} onChange={e => setForm({...form, platform: e.target.value})} className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none'>
              <option value='custom'>Custom Website</option>
              <option value='shopify'>Shopify</option>
              <option value='woocommerce'>WooCommerce</option>
            </select>
          </div>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Website URL</label>
            <input type='url' value={form.website_url} onChange={e => setForm({...form, website_url: e.target.value})} className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none' placeholder='https://mystore.com' />
          </div>
          <button type='submit' disabled={loading} className='w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition disabled:opacity-50'>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p className='text-gray-500 text-sm text-center mt-6'>Already have an account? <a href='/login' className='text-green-400 hover:underline'>Sign in</a></p>
      </div>
    </div>
  );
}
