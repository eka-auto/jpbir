const messages = {
  INVALID_EMAIL_OR_PASSWORD: 'Email or password is incorrect.',
  USER_ALREADY_EXISTS: 'An account with that email already exists. Try signing in.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with that email already exists. Try signing in.',
  EMAIL_NOT_VERIFIED: 'Verify your email before signing in.',
  PASSWORD_TOO_SHORT: 'Use a password with at least 8 characters.',
  TOO_MANY_REQUESTS: 'Too many attempts. Please try again later.',
  INVALID_ORIGIN: 'This site is not allowed to sign in. Contact the site administrator.',
  INVALID_OTP: 'That verification code is invalid or has expired. Request a new code.',
  OTP_EXPIRED: 'That verification code is invalid or has expired. Request a new code.',
  TOO_MANY_ATTEMPTS: 'Too many verification attempts. Request a new code.',
};

function errorMessage(error, fallback) {
  for (const code of [error?.error?.code, error?.code]) {
    if (typeof code === 'string' && Object.hasOwn(messages, code)) return messages[code];
  }
  return fallback;
}

async function checked(call) {
  let result;
  try { result = await call(); }
  catch (error) { throw new Error(errorMessage(error, 'Could not reach the sign-in service. Please try again.')); }
  if (result?.error) {
    throw new Error(errorMessage(result.error, 'The request could not be completed. Please try again.'));
  }
  return result?.data;
}

export function createAccountActions(client) {
  const currentUser = async () => (await checked(() => client.getSession({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } })))?.user || null;
  return {
    currentUser,
    async signUp({ name, email, password }) {
      await checked(() => client.signUp.email({ name, email, password }));
      const user = await currentUser();
      return { user, requiresVerification: !user };
    },
    async signIn({ email, password }) {
      await checked(() => client.signIn.email({ email, password }));
      return currentUser();
    },
    async signOut() { await checked(() => client.signOut()); },
    async sendVerification(email) {
      await checked(() => client.emailOtp.sendVerificationOtp({ email, type: 'email-verification' }));
    },
    async verifyEmail({ email, otp }) {
      await checked(() => client.emailOtp.verifyEmail({ email, otp }));
      return currentUser();
    },
  };
}
