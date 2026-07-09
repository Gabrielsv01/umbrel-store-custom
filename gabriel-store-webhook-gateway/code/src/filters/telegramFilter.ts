// Config esperada (já normalizada): { chatIds: string[], usernames: string[] }.
// Fail-closed: sem nenhuma allowlist configurada, nega a requisição.
function telegramFilter(payload: any, config: any): boolean {
    const message = payload?.message || payload?.my_chat_member;

    const chatIds: string[] = config?.chatIds ?? [];
    const usernames: string[] = config?.usernames ?? [];

    if (chatIds.length === 0 && usernames.length === 0) {
        return false;
    }

    const chatId = message?.chat?.id;
    const isChatAuthorized = chatId !== undefined && chatId !== null
        && chatIds.includes(chatId.toString());

    const username = message?.from?.username;
    const isUserAuthorized = Boolean(username) && usernames.includes(username);

    return isChatAuthorized || isUserAuthorized;
}

export default telegramFilter;
