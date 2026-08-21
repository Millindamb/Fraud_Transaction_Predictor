import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui/Primitives';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(form.email, form.password);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Those credentials did not match an account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-2">
          <ShieldAlert size={18} className="text-ml" />
          <span className="font-display text-[15px] font-extrabold tracking-tight">FraudGuard</span>
        </div>
        <h1 className="font-display text-xl font-extrabold tracking-tight">Sign in to the console</h1>
        <p className="mt-1 text-sm text-slate1">
          Access is limited to fraud operations and risk engineering.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Work email">
            <Input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="analyst@bank.in"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>

          {error && <p className="text-sm text-band-critical">{error}</p>}

          <Button className="w-full" busy={busy} onClick={submit}>
            Sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
