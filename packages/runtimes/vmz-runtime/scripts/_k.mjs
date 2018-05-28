export default class K {
    async bootstrap() {
        await new Promise((r) => setTimeout(r, 100));
        return { installed: false, siteTitle: 't' };
    }
}
