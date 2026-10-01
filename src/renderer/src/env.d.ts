import type { KontorApi } from '../../shared/api'

declare global {
  interface Window {
    kontor: KontorApi
  }
}
