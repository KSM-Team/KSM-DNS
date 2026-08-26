import cloudflareLogo from '@/assets/logos/cloudflare.svg'
import spaceshipLogo from '@/assets/logos/spaceship.svg'
import letsencryptLogo from '@/assets/logos/letsencrypt.svg'
import namesiloLogo from '@/assets/logos/namesilo.svg'
import aliyunLogo from '@/assets/logos/aliyun.svg'
import tencentLogo from '@/assets/logos/tencent.svg'
import zerosslLogo from '@/assets/logos/zerossl.svg'
import googleLogo from '@/assets/logos/google.svg'
import porkbunLogo from '@/assets/logos/porkbun.svg'

export type ProviderType =
  | 'cloudflare'
  | 'spaceship'
  | 'letsencrypt'
  | 'namesilo'
  | 'aliyun'
  | 'tencent'
  | 'zerossl'
  | 'google'
  | 'porkbun'

export const providerLogo: Record<string, string> = {
  cloudflare: cloudflareLogo,
  spaceship: spaceshipLogo,
  letsencrypt: letsencryptLogo,
  namesilo: namesiloLogo,
  aliyun: aliyunLogo,
  tencent: tencentLogo,
  zerossl: zerosslLogo,
  google: googleLogo,
  porkbun: porkbunLogo,
}

export const providerShort: Record<string, string> = {
  cloudflare: 'CF',
  spaceship: 'SP',
  letsencrypt: 'LE',
  namesilo: 'NS',
  aliyun: 'ALI',
  tencent: 'TC',
  zerossl: 'ZSSL',
  google: 'GTS',
  porkbun: 'PB',
}

export const providerLabel: Record<string, string> = {
  cloudflare: 'Cloudflare',
  spaceship: 'Spaceship',
  letsencrypt: "Let's Encrypt",
  namesilo: 'Namesilo',
  aliyun: '阿里云',
  tencent: '腾讯云',
  zerossl: 'ZeroSSL',
  google: 'Google Trust Services',
  porkbun: 'Porkbun',
}

export const providerColor: Record<string, string> = {
  cloudflare: '#F38020',
  spaceship: '#394EFF',
  letsencrypt: '#003A70',
  namesilo: '#F26722',
  aliyun: '#FF6A00',
  tencent: '#006EFF',
  zerossl: '#00B67A',
  google: '#4285F4',
  porkbun: '#E22D48',
}