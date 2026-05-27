import QRCode from 'qrcode'

const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin

export function getOrderUrl(orderId: string): string {
  return `${APP_URL}/pedido/${orderId}`
}

export async function generateQRCodeDataURL(orderId: string): Promise<string> {
  const url = getOrderUrl(orderId)
  return QRCode.toDataURL(url, {
    width: 280,
    margin: 2,
    color: {
      dark: '#04342C',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  })
}

export async function generateQRCodeSVG(orderId: string): Promise<string> {
  const url = getOrderUrl(orderId)
  return QRCode.toString(url, {
    type: 'svg',
    width: 200,
    margin: 2,
    color: {
      dark: '#04342C',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  })
}
