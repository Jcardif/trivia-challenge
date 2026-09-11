import { invokeOperation } from './rayfinClient'
import type { RegisterUserRequest, User } from '../types/api'
import { ensureStationAccess } from '../lib/stationLockdown'

export const userService = {
  async register(payload: RegisterUserRequest): Promise<User> {
    ensureStationAccess()
    return invokeOperation('registerPlayer', payload)
  },
}
