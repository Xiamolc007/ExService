import { describe, expect, it } from 'vitest'
import { minimumAvatarZoom } from '@components/src/avatarCrop'

describe('minimumAvatarZoom', () => {
  it('keeps a square image fully visible in a square crop inside a wide container', () => {
    const media = { width: 320, height: 320, naturalWidth: 512, naturalHeight: 512 }
    expect(minimumAvatarZoom(media, { width: 320, height: 320 })).toBe(1)
  })

  it('updates the minimum when the actual crop area changes size', () => {
    const media = { width: 160, height: 160, naturalWidth: 64, naturalHeight: 64 }
    expect(minimumAvatarZoom(media, { width: 320, height: 320 })).toBe(2)
    expect(minimumAvatarZoom(media, { width: 120, height: 120 })).toBe(1)
  })
})
