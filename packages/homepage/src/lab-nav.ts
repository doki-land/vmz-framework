/** Shared navigation for internal demo pages under `/lab`.

Every lab page links back to the catalog instead of to other demos by
internal code name, so the demo surface never looks like a product route.
*/
export function labNav(label = 'Component demos') {
    return [{ id: 'lab', title: label, href: '/lab' }];
}
