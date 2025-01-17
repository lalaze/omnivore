import { EntityManager } from 'typeorm'
import { StatusType } from '../datalayer/user/model'
import { GroupMembership } from '../entity/groups/group_membership'
import { Invite } from '../entity/groups/invite'
import { Profile } from '../entity/profile'
import { User } from '../entity/user'
import { getRepository } from '../entity/utils'
import { SignupErrorCode } from '../generated/graphql'
import { AuthProvider } from '../routers/auth/auth_types'
import { AppDataSource } from '../server'
import { logger } from '../utils/logger'
import { validateUsername } from '../utils/usernamePolicy'
import { sendConfirmationEmail } from './send_emails'
import { Filter } from '../entity/filter'

export const createUser = async (input: {
  provider: AuthProvider
  sourceUserId?: string
  email: string
  username: string
  name: string
  pictureUrl?: string
  bio?: string
  groups?: [string]
  inviteCode?: string
  password?: string
  pendingConfirmation?: boolean
}): Promise<[User, Profile]> => {
  const trimmedEmail = input.email.trim()
  const existingUser = await getUserByEmail(trimmedEmail)
  if (existingUser) {
    if (existingUser.profile) {
      return Promise.reject({ errorCode: SignupErrorCode.UserExists })
    }

    // create profile if user exists but profile does not exist
    const profile = await getRepository(Profile).save({
      username: input.username,
      pictureUrl: input.pictureUrl,
      bio: input.bio,
      user: existingUser,
    })

    return [existingUser, profile]
  }

  if (!validateUsername(input.username)) {
    return Promise.reject({ errorCode: SignupErrorCode.InvalidUsername })
  }

  const [user, profile] = await AppDataSource.transaction<[User, Profile]>(
    async (t) => {
      let hasInvite = false
      let invite: Invite | null = null

      if (input.inviteCode) {
        const inviteCodeRepo = t.getRepository(Invite)
        invite = await inviteCodeRepo.findOne({
          where: { code: input.inviteCode },
          relations: ['group'],
        })
        if (invite && (await validateInvite(t, invite))) {
          hasInvite = true
        }
      }
      const user = await t.getRepository(User).save({
        source: input.provider,
        name: input.name,
        email: trimmedEmail,
        sourceUserId: input.sourceUserId,
        password: input.password,
        status: input.pendingConfirmation
          ? StatusType.Pending
          : StatusType.Active,
      })
      const profile = await t.getRepository(Profile).save({
        username: input.username,
        pictureUrl: input.pictureUrl,
        bio: input.bio,
        user,
      })
      if (hasInvite && invite) {
        await t.getRepository(GroupMembership).save({
          user: user,
          invite: invite,
          group: invite.group,
        })
      }

      await createDefaultFiltersForUser(t)(user.id)

      return [user, profile]
    }
  )

  if (input.pendingConfirmation) {
    if (!(await sendConfirmationEmail(user))) {
      return Promise.reject({ errorCode: SignupErrorCode.InvalidEmail })
    }
  }

  return [user, profile]
}

const createDefaultFiltersForUser =
  (t: EntityManager) =>
  async (userId: string): Promise<Filter[]> => {
    const defaultFilters = [
      { name: 'Inbox', filter: 'in:inbox' },
      { name: 'Continue Reading', filter: 'in:inbox sort:read-desc is:unread' },
      { name: 'Non-Feed Items', filter: 'in:library' },
      { name: 'Highlights', filter: 'has:highlights mode:highlights' },
      { name: 'Unlabeled', filter: 'no:label' },
      { name: 'Oldest First', filter: 'sort:saved-asc' },
      { name: 'Files', filter: 'type:file' },
      { name: 'Archived', filter: 'in:archive' },
    ].map((it, position) => ({
      ...it,
      user: { id: userId },
      position,
      defaultFilter: true,
      category: 'Search',
    }))

    return t.getRepository(Filter).save(defaultFilters)
  }

// TODO: Maybe this should be moved into a service
const validateInvite = async (
  entityManager: EntityManager,
  invite: Invite
): Promise<boolean> => {
  if (invite.expirationTime < new Date()) {
    logger.info('rejecting invite, expired', invite)
    return false
  }
  const membershipRepo = entityManager.getRepository(GroupMembership)
  const numMembers = await membershipRepo.countBy({ invite: { id: invite.id } })
  if (numMembers >= invite.maxMembers) {
    logger.info('rejecting invite, too many users', invite, numMembers)
    return false
  }
  return true
}

export const getUserByEmail = async (email: string): Promise<User | null> => {
  return getRepository(User)
    .createQueryBuilder('user')
    .leftJoinAndSelect('user.profile', 'profile')
    .where('LOWER(email) = LOWER(:email)', { email }) // case insensitive
    .getOne()
}
