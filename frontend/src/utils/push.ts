// Web Push helpers for the PWA. All subscription actions must be triggered by
// a direct user gesture — Apple's Web Push on iOS/iPadOS only permits requesting
// permission (and thus subscribing) in response to user interaction.

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  return navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription())
}

export async function pushSupported(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return false
  }
  return true
}

export async function pushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!(await pushSupported())) return 'unsupported'
  return Notification.permission
}

// isStandalone reports whether the app is running as an installed PWA. Apple
// requires the web app be added to the Home Screen (standalone display) before
// Web Push is available, so we surface this to guide the user.
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscription | null> {
  if (!(await pushSupported())) throw new Error('当前浏览器不支持 Web Push')
  if (!publicKey) throw new Error('VAPID 公钥未配置')

  const reg = await navigator.serviceWorker.ready
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('通知权限被拒绝，请允许浏览器通知后再试')
  }

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  return subscription
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!(await pushSupported())) return null
  return getCurrentSubscription()
}
