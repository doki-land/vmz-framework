/** Locale-aware document metadata for the site pages. */
export function pageMeta(zh, en, descriptionZh = "", descriptionEn = "") {
    return (ctx) => {
        let isEnglish = false;
        if (ctx && typeof ctx.localeId === "string" && ctx.localeId) {
            isEnglish = ctx.localeId.indexOf("en") === 0;
        } else {
            let pathname = "";
            if (ctx && typeof ctx.pathname === "string") pathname = ctx.pathname;
            else if (globalThis.location && typeof globalThis.location.pathname === "string") {
                pathname = globalThis.location.pathname;
            }
            isEnglish = pathname.indexOf("/en-us") === 0;
        }
        return {
            title: isEnglish ? en : zh,
            description: isEnglish ? descriptionEn : descriptionZh,
        };
    };
}
