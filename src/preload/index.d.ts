import type { EaveApi } from './index'

declare global {
  interface Window {
    eave: EaveApi
  }
}

export {}
