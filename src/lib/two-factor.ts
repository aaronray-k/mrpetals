import { getSupabase } from '~/lib/supabase'

export interface TwoFactorStatus {
  required: boolean
  verified: boolean
  totp: boolean
  email_available: boolean
  remember_days: number
  devices: number
  locked: boolean
}
export interface VerifyResult {
  ok: boolean
  error?: string
  device_token?: string | null
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const twoFactorStatus = () => rpc<TwoFactorStatus>('my_two_factor_status')
export const startTotpSetup = () => rpc<{ secret: string; uri: string }>('start_totp_setup')
export const verifyTotp = (code: string, remember: boolean) => rpc<VerifyResult>('verify_totp', { p_code: code, p_remember: remember })
export const sendEmailCode = () => rpc<{ sent_to: string; demo_code: string | null }>('send_two_factor_email')
export const verifyEmailCode = (code: string, remember: boolean) => rpc<VerifyResult>('verify_email_code', { p_code: code, p_remember: remember })
export const forgetMyDevices = () => rpc<number>('forget_my_devices')
export const adminResetTwoFactor = (userId: string) => rpc<void>('admin_reset_two_factor', { p_user_id: userId })

/** The sign-in session in the access token: two-factor is checked per session. */
export function sessionIdOf(accessToken: string | undefined) {
  try {
    const payload = JSON.parse(atob(accessToken!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    return (payload.session_id as string | undefined) ?? null
  } catch {
    return null
  }
}

// "Remember this device": a random token kept in this browser, valid 30 days on the server.
const deviceKey = (userId: string) => `cf.two-factor-device.${userId}`
export function rememberedDevice(userId: string) {
  try {
    return localStorage.getItem(deviceKey(userId))
  } catch {
    return null
  }
}
export function setRememberedDevice(userId: string, token: string | null) {
  try {
    if (token) localStorage.setItem(deviceKey(userId), token)
    else localStorage.removeItem(deviceKey(userId))
  } catch {
    // private window: the device just isn't remembered
  }
}
export async function tryRememberedDevice(userId: string) {
  const token = rememberedDevice(userId)
  if (!token) return false
  const ok = await rpc<boolean>('use_remembered_device', { p_token: token })
  if (!ok) setRememberedDevice(userId, null)
  return ok
}
