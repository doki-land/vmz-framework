import type { User } from '#server/db/users';

/** Third-party wrappers — still addressed as `#server/integrations/...`. */
export class ProfileClient {
    async enrich(user: User): Promise<User> {
        return {
            ...user,
            bio: `${user.bio} + profile-api`,
        };
    }
}
