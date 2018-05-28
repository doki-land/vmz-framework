export type User = {
    id: string;
    name: string;
    bio: string;
};

/** Database access — class so decorators stay legal. */
export class UsersRepository {
    async findDefault(): Promise<User> {
        return {
            id: '1',
            name: 'Ada',
            bio: 'from db',
        };
    }

    async list(): Promise<User[]> {
        return [await this.findDefault()];
    }

    async findById(id: string): Promise<User> {
        return {
            id,
            name: 'Ada',
            bio: 'from db',
        };
    }

    async create(input: { name: string; bio: string }): Promise<User> {
        return {
            id: 'new',
            name: input.name,
            bio: input.bio,
        };
    }
}
