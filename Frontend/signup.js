import { createAuthClient } from '@neon/auth';
import { createAccountActions } from './auth-session.js';

const form = document.querySelector('#account-form');
const message = document.querySelector('#message');
const account = document.querySelector('#account');
const submit = document.querySelector('#submit');
const toggle = document.querySelector('#toggle-mode');
const nameField = document.querySelector('#name');
const passwordField = document.querySelector('#password');
const verificationForm = document.querySelector('#verification-form');
const verificationEmail = document.querySelector('#verification-email');
const verificationCode = document.querySelector('#verification-code');
const openVerification = document.querySelector('#open-verification');
let mode = 'signup';
let actions;

function showUser(user) {
  form.hidden = Boolean(user);
  toggle.hidden = Boolean(user);
  openVerification.hidden = Boolean(user);
  account.hidden = !user;
  verificationForm.hidden = true;
  document.querySelector('#current-email').textContent = user?.email || '';
  document.querySelector('#current-name').textContent = user?.name || '';
  passwordField.value = '';
  verificationCode.value = '';
}

function showMessage(text, error = false) {
  message.textContent = text;
  message.dataset.error = String(error);
}

function setMode(next) {
  mode = next;
  document.querySelector('#heading').textContent = mode === 'signup' ? 'Create your account' : 'Sign in';
  submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  toggle.textContent = mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account';
  nameField.closest('label').hidden = mode === 'signin';
  nameField.required = mode === 'signup';
  passwordField.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  passwordField.value = '';
  showMessage('');
}
toggle.addEventListener('click', () => setMode(mode === 'signup' ? 'signin' : 'signup'));

function showVerification(email) {
  verificationForm.hidden = false;
  verificationEmail.value = email;
  verificationCode.value = '';
}
openVerification.addEventListener('click', () => showVerification(document.querySelector('#email').value.trim()));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!actions) return;
  submit.disabled = true;
  toggle.disabled = true;
  showMessage(mode === 'signup' ? 'Creating your account…' : 'Signing in…');
  const input = {
    name: nameField.value.trim(),
    email: document.querySelector('#email').value.trim(),
    password: passwordField.value,
  };
  try {
    if (mode === 'signup') {
      const result = await actions.signUp(input);
      showUser(result.user);
      if (result.requiresVerification) showVerification(input.email);
      showMessage(result.requiresVerification ? 'Account created. Send a verification code to your email, then enter it below.' : 'Your account is ready. You are signed in.');
    } else {
      const user = await actions.signIn(input);
      showUser(user);
      showMessage(user ? 'You are signed in.' : 'Please verify your email, then sign in.');
    }
  } catch (error) {
    if (error.message === 'Verify your email before signing in.') showVerification(input.email);
    showMessage(error.message, true);
  }
  finally { passwordField.value = ''; submit.disabled = false; toggle.disabled = false; }
});

document.querySelector('#send-code').addEventListener('click', async (event) => {
  if (!verificationEmail.reportValidity() || !actions) return;
  event.target.disabled = true;
  try {
    await actions.sendVerification(verificationEmail.value.trim());
    showMessage('Verification code sent. Enter it below.');
  } catch (error) { showMessage(error.message, true); }
  finally { event.target.disabled = false; }
});

verificationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#verify-email');
  button.disabled = true;
  try {
    const email = verificationEmail.value.trim();
    const user = await actions.verifyEmail({ email, otp: verificationCode.value.trim() });
    showUser(user);
    if (!user) {
      setMode('signin');
      document.querySelector('#email').value = email;
    }
    showMessage(user ? 'Email verified. You are signed in.' : 'Email verified. Sign in with your password.');
  } catch (error) { showMessage(error.message, true); }
  finally { verificationCode.value = ''; button.disabled = false; }
});

document.querySelector('#sign-out').addEventListener('click', async (event) => {
  event.target.disabled = true;
  try { await actions.signOut(); showUser(null); showMessage('You are signed out.'); }
  catch (error) { showMessage(error.message, true); }
  finally { event.target.disabled = false; }
});

try {
  const response = await fetch('/api/auth-config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Email signup is not configured on this deployment.');
  const { authUrl } = await response.json();
  actions = createAccountActions(createAuthClient(authUrl));
  showUser(await actions.currentUser());
  submit.disabled = false;
  toggle.disabled = false;
  openVerification.disabled = false;
  showMessage('');
} catch (error) { showMessage(error.message, true); }
