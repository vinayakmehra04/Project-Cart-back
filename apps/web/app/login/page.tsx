'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, { email, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('client', JSON.stringify(res.data.client));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className='min-h-screen bg-gray-950 flex items-center justify-center'>
      <div className='bg-gray-900 p-8 rounded-2xl w-full max-w-md border border-gray-800'>
        <h1 className='text-3xl font-bold text-white mb-2'>🛒 CartBack</h1>
        <p className='text-gray-400 mb-8'>Sign in to your dashboard</p>
        {error && <div className='bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg mb-6'>{error}</div>}
        <form onSubmit={handleLogin} className='space-y-4'>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Email</label>
            <input type='email' value={email} onChange={e => setEmail(e.target.value)} required className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none' placeholder='you@example.com' />
          </div>
          <div>
            <label className='text-gray-400 text-sm mb-1 block'>Password</label>
            <input type='password' value={password} onChange={e => setPassword(e.target.value)} required className='w-full bg-gray-800 text-white px-4 py-3 rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none' placeholder='••••••••' />
          </div>
          <button type='submit' disabled={loading} className='w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition disabled:opacity-50'>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p className='text-gray-500 text-sm text-center mt-6'>Don't have an account? <a href='/register' className='text-green-400 hover:underline'>Register</a></p>
      </div>
    </div>
  );
}
