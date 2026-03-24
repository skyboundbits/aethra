/**
 * src/utils/appContentUtils.ts
 * Utilities for working with pre-authored app characters and avatars.
 */

import type { CharacterProfile, CharacterAvatarCrop } from '../types'

/**
 * Convert an app character template into a campaign-scoped CharacterProfile.
 * Creates a new instance with a fresh ID, timestamps, and controlledBy set to 'ai'.
 * Tracks the source via reusableCharacterId.
 */
export function createCharacterFromAppTemplate(appCharacter: {
  id: string
  name: string
  role: string
  gender: 'male' | 'female' | 'non-specific'
  pronouns: 'he/him' | 'she/her' | 'they/them'
  description: string
  personality: string
  speakingStyle: string
  goals: string
  avatarImageData: string
  avatarCrop: CharacterAvatarCrop
}): Omit<CharacterProfile, 'id' | 'folderName'> {
  const now = Date.now()

  return {
    name: appCharacter.name,
    role: appCharacter.role,
    gender: appCharacter.gender,
    pronouns: appCharacter.pronouns,
    description: appCharacter.description,
    personality: appCharacter.personality,
    speakingStyle: appCharacter.speakingStyle,
    goals: appCharacter.goals,
    avatarImageData: appCharacter.avatarImageData,
    avatarCrop: appCharacter.avatarCrop,
    reusableCharacterId: appCharacter.id,
    controlledBy: 'ai',
    avatarSourceId: undefined,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Convert an app avatar into a ReusableAvatar.
 * Creates a new instance with a fresh ID and timestamps.
 */
export function createReusableAvatarFromAppTemplate(appAvatar: {
  id: string
  name: string
  imageData: string
  crop: CharacterAvatarCrop
}) {
  const now = Date.now()

  return {
    id: `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: appAvatar.name,
    imageData: appAvatar.imageData,
    crop: appAvatar.crop,
    createdAt: now,
    updatedAt: now,
  }
}
