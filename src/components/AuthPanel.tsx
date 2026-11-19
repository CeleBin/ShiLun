import { useId, useState, type FormEvent } from 'react';
import { AccountDialog } from './AccountPanel';
import { Icon } from './Icons';
import { USERNAME_MAX_LENGTH } from '../shared/contracts';

export default function AuthPanel({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const registering = mode === 'register';
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setPending(true); setNotice('');
    try {
      const response = await fetch(`/api/auth?action=${mode}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || '操作失败，请稍后重试。');
      await onSuccess();
    } catch (error) { setNotice(error instanceof Error ? error.message : '账号服务暂时不可用。'); }
    finally { setPending(false); }
  }
  return <AccountDialog compact title={registering ? '创建账号' : '登录 ShiLun'} onClose={onClose}>
    <form className="account-form auth-form" onSubmit={event => void submit(event)}>
      <fieldset disabled={pending}>
        <label>用户名<input required maxLength={USERNAME_MAX_LENGTH} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event => setUsername(event.target.value)} /></label>
        <div className="auth-password-field">
          <label htmlFor={passwordId}>密码</label>
          <div className="auth-password-input">
            <input id={passwordId} type={showPassword ? 'text' : 'password'} required placeholder=" " autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={event => {
              const value = event.target.value;
              setPassword(value);
              if (!value) setShowPassword(false);
            }} />
            <button type="button" aria-controls={passwordId} aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(current => !current)}>
              <Icon name={showPassword ? 'eyeOff' : 'eye'} />
            </button>
          </div>
        </div>
        {registering && <p className="account-auth-note">暂不支持找回密码，请妥善保管。</p>}
        {notice && <p className="account-notice is-error" role="alert">{notice}</p>}
        <button type="submit" className="account-primary">{pending ? '请稍候…' : registering ? '创建账号' : '登录'}</button>
      </fieldset>
    </form>
    <p className="account-auth-switch">{registering ? '已有账号？' : '还没有账号？'} <button className="account-text-button" type="button" disabled={pending} onClick={() => {
      setMode(registering ? 'login' : 'register');
      setPassword('');
      setShowPassword(false);
      setNotice('');
    }}>{registering ? '返回登录' : '立即注册'}</button></p>
  </AccountDialog>;
}
