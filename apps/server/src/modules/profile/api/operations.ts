import { updateCurrentUser, uploadCurrentUserAvatar, getAvatarImage } from './handlers.js'

export const operations = {
  updateCurrentUser,
  uploadCurrentUserAvatar,
  getAvatarImage,
} as const
